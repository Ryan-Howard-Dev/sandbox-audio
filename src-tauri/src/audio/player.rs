use parking_lot::Mutex;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativePlaybackState {
    Idle,
    Loading,
    Playing,
    Paused,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePlaybackStatus {
    pub state: NativePlaybackState,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub sample_rate_hz: u32,
    pub bits_per_sample: u16,
    pub channels: u16,
    pub codec: String,
    pub exclusive_mode: bool,
    pub resampling: bool,
    pub error: Option<String>,
}

impl Default for NativePlaybackStatus {
    fn default() -> Self {
        Self {
            state: NativePlaybackState::Idle,
            position_secs: 0.0,
            duration_secs: 0.0,
            sample_rate_hz: 0,
            bits_per_sample: 0,
            channels: 0,
            codec: String::new(),
            exclusive_mode: false,
            resampling: false,
            error: None,
        }
    }
}

struct PlayerControl {
    stop: AtomicBool,
    pause: AtomicBool,
    seek_secs: Mutex<Option<f64>>,
    position_us: AtomicU64,
    duration_us: AtomicU64,
    sample_rate: AtomicU64,
    bits: AtomicU64,
    channels: AtomicU64,
    exclusive: AtomicBool,
    resampling: AtomicBool,
    state: Mutex<NativePlaybackState>,
    codec: Mutex<String>,
    error: Mutex<Option<String>>,
}

impl PlayerControl {
    fn new() -> Self {
        Self {
            stop: AtomicBool::new(false),
            pause: AtomicBool::new(false),
            seek_secs: Mutex::new(None),
            position_us: AtomicU64::new(0),
            duration_us: AtomicU64::new(0),
            sample_rate: AtomicU64::new(0),
            bits: AtomicU64::new(0),
            channels: AtomicU64::new(0),
            exclusive: AtomicBool::new(false),
            resampling: AtomicBool::new(false),
            state: Mutex::new(NativePlaybackState::Idle),
            codec: Mutex::new(String::new()),
            error: Mutex::new(None),
        }
    }

    fn set_state(&self, state: NativePlaybackState) {
        *self.state.lock() = state;
    }

    fn status(&self) -> NativePlaybackStatus {
        NativePlaybackStatus {
            state: *self.state.lock(),
            position_secs: self.position_us.load(Ordering::Relaxed) as f64 / 1_000_000.0,
            duration_secs: self.duration_us.load(Ordering::Relaxed) as f64 / 1_000_000.0,
            sample_rate_hz: self.sample_rate.load(Ordering::Relaxed) as u32,
            bits_per_sample: self.bits.load(Ordering::Relaxed) as u16,
            channels: self.channels.load(Ordering::Relaxed) as u16,
            codec: self.codec.lock().clone(),
            exclusive_mode: self.exclusive.load(Ordering::Relaxed),
            resampling: self.resampling.load(Ordering::Relaxed),
            error: self.error.lock().clone(),
        }
    }
}

pub struct NativePlayer {
    control: Arc<PlayerControl>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl NativePlayer {
    pub fn new() -> Self {
        Self {
            control: Arc::new(PlayerControl::new()),
            thread: Mutex::new(None),
        }
    }

    pub fn status(&self) -> NativePlaybackStatus {
        self.control.status()
    }

    pub fn stop(&self) {
        self.control.stop.store(true, Ordering::SeqCst);
        self.control.pause.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.lock().take() {
            let _ = handle.join();
        }
        self.control.set_state(NativePlaybackState::Stopped);
    }

    pub fn pause(&self) {
        self.control.pause.store(true, Ordering::SeqCst);
        self.control.set_state(NativePlaybackState::Paused);
    }

    pub fn resume(&self) {
        self.control.pause.store(false, Ordering::SeqCst);
        self.control.set_state(NativePlaybackState::Playing);
    }

    pub fn seek(&self, seconds: f64) {
        *self.control.seek_secs.lock() = Some(seconds.max(0.0));
    }

    pub fn play_url(
        &self,
        url: String,
        device_id: Option<String>,
        exclusive_mode: bool,
    ) -> Result<(), String> {
        self.stop();
        self.control.stop.store(false, Ordering::SeqCst);
        self.control.pause.store(false, Ordering::SeqCst);
        *self.control.error.lock() = None;
        self.control.set_state(NativePlaybackState::Loading);

        let control = Arc::clone(&self.control);
        let handle = thread::spawn(move || {
            if let Err(err) = run_playback_thread(url, device_id, exclusive_mode, control.clone()) {
                *control.error.lock() = Some(err.clone());
                control.set_state(NativePlaybackState::Error);
            } else if !control.stop.load(Ordering::SeqCst) {
                control.set_state(NativePlaybackState::Stopped);
            }
        });

        *self.thread.lock() = Some(handle);
        Ok(())
    }
}

fn run_playback_thread(
    url: String,
    device_id: Option<String>,
    exclusive_mode: bool,
    control: Arc<PlayerControl>,
) -> Result<(), String> {
    use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::{MediaSourceStream, ReadOnlySource};
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let response = reqwest::blocking::get(&url).map_err(|e| format!("HTTP fetch failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let reader = ReadOnlySource::new(std::io::BufReader::new(response));
    let mss = MediaSourceStream::new(Box::new(reader), Default::default());

    let mut hint = Hint::new();
    if url.ends_with(".flac") {
        hint.with_extension("flac");
    } else if url.ends_with(".wav") {
        hint.with_extension("wav");
    } else if url.ends_with(".mp3") {
        hint.with_extension("mp3");
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Format probe failed: {e}"))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "No default audio track".to_string())?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();

    let sample_rate = codec_params.sample_rate.unwrap_or(44100);
    let channels = codec_params.channels.map(|c| c.count()).unwrap_or(2) as u16;
    let bits = codec_params.bits_per_coded_sample.unwrap_or(16) as u16;

    let codec_name = match codec_params.codec {
        symphonia::core::codecs::CODEC_TYPE_FLAC => "FLAC".to_string(),
        symphonia::core::codecs::CODEC_TYPE_PCM_S16LE => "PCM".to_string(),
        symphonia::core::codecs::CODEC_TYPE_PCM_S24LE => "PCM24".to_string(),
        symphonia::core::codecs::CODEC_TYPE_PCM_S32LE => "PCM32".to_string(),
        symphonia::core::codecs::CODEC_TYPE_MP3 => "MP3".to_string(),
        symphonia::core::codecs::CODEC_TYPE_VORBIS => "Vorbis".to_string(),
        symphonia::core::codecs::CODEC_TYPE_AAC => "AAC".to_string(),
        other if other != CODEC_TYPE_NULL => format!("{other:?}"),
        _ => "unknown".to_string(),
    };

    let duration_us = codec_params
        .n_frames
        .map(|n| n * 1_000_000 / sample_rate as u64)
        .unwrap_or(0);

    control.sample_rate.store(sample_rate as u64, Ordering::Relaxed);
    control.bits.store(bits as u64, Ordering::Relaxed);
    control.channels.store(channels as u64, Ordering::Relaxed);
    control.duration_us.store(duration_us, Ordering::Relaxed);
    *control.codec.lock() = codec_name.clone();
    control.resampling.store(false, Ordering::Relaxed);

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Decoder init failed: {e}"))?;

    #[cfg(windows)]
    let mut output = {
        if exclusive_mode {
            eprintln!(
                "[audiophile] WASAPI exclusive mode is not bundled yet; using cpal shared output"
            );
        }
        control.exclusive.store(false, Ordering::Relaxed);
        PlaybackOutput::Cpal(open_cpal_output(device_id.as_deref(), sample_rate, channels)?)
    };

    #[cfg(not(windows))]
    let mut output = {
        control.exclusive.store(false, Ordering::Relaxed);
        PlaybackOutput::Cpal(open_cpal_output(device_id.as_deref(), sample_rate, channels)?)
    };

    control.set_state(NativePlaybackState::Playing);

    loop {
        if control.stop.load(Ordering::SeqCst) {
            break;
        }

        if let Some(seek_to) = control.seek_secs.lock().take() {
            use symphonia::core::formats::SeekTo;
            use symphonia::core::units::Time;
            let _ = format.seek(
                symphonia::core::formats::SeekMode::Accurate,
                SeekTo::Time {
                    time: Time::from(seek_to),
                    track_id: Some(track_id),
                },
            );
            control
                .position_us
                .store((seek_to * 1_000_000.0) as u64, Ordering::Relaxed);
        }

        while control.pause.load(Ordering::SeqCst) && !control.stop.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(50));
        }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::ResetRequired) => continue,
            Err(Error::IoError(_)) => break,
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(buf) => buf,
            Err(Error::IoError(_)) => break,
            Err(Error::DecodeError(_)) => continue,
            Err(_) => break,
        };

        let frames = write_buffer_to_output(&mut output, decoded, sample_rate, channels)?;
        let pos_us = control.position_us.load(Ordering::Relaxed)
            + (frames as u64 * 1_000_000 / sample_rate as u64);
        control.position_us.store(pos_us, Ordering::Relaxed);

        if duration_us > 0 && pos_us >= duration_us {
            break;
        }
    }

    Ok(())
}

enum PlaybackOutput {
    Cpal(CpalOutput),
}

struct CpalOutput {
    _stream: cpal::Stream,
    tx: std::sync::mpsc::SyncSender<Vec<f32>>,
}

fn open_cpal_output(
    device_id: Option<&str>,
    sample_rate: u32,
    channels: u16,
) -> Result<CpalOutput, String> {
    use cpal::SampleFormat;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = if let Some(id) = device_id {
        host.output_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().ok().as_deref() == Some(id))
            .ok_or_else(|| format!("Device not found: {id}"))?
    } else {
        host.default_output_device()
            .ok_or_else(|| "No default output device".to_string())?
    };

    let supported = device
        .supported_output_configs()
        .map_err(|e| e.to_string())?
        .find(|c| c.channels() == channels)
        .ok_or_else(|| "No matching output config".to_string())?;

    let desired_rate = cpal::SampleRate(sample_rate);
    let supported_config = supported
        .try_with_sample_rate(desired_rate)
        .unwrap_or_else(|| supported.with_max_sample_rate());
    let config = supported_config.config();
    let sample_format = supported_config.sample_format();
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(8);
    let mut pending: Vec<f32> = Vec::new();
    let ch = config.channels as usize;

    let stream = match sample_format {
        SampleFormat::F32 => device.build_output_stream(
            &config,
            move |out: &mut [f32], _| {
                fill_output(out, &rx, &mut pending, ch);
            },
            |_| {},
            None,
        ),
        SampleFormat::I16 => device.build_output_stream(
            &config,
            move |out: &mut [i16], _| {
                let mut f32_buf = vec![0.0f32; out.len()];
                fill_output(&mut f32_buf, &rx, &mut pending, ch);
                for (o, s) in out.iter_mut().zip(f32_buf.iter()) {
                    *o = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
                }
            },
            |_| {},
            None,
        ),
        _ => return Err("Unsupported sample format".to_string()),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    Ok(CpalOutput {
        _stream: stream,
        tx,
    })
}

fn fill_output(
    out: &mut [f32],
    rx: &std::sync::mpsc::Receiver<Vec<f32>>,
    pending: &mut Vec<f32>,
    channels: usize,
) {
    while pending.len() < out.len() {
        match rx.try_recv() {
            Ok(chunk) => pending.extend(chunk),
            Err(_) => {
                pending.resize(out.len(), 0.0);
                break;
            }
        }
    }
    let n = out.len().min(pending.len());
    out[..n].copy_from_slice(&pending[..n]);
    pending.drain(..n);
    if out.len() > n {
        out[n..].fill(0.0);
    }
    let _ = channels;
}

fn write_buffer_to_output(
    output: &mut PlaybackOutput,
    decoded: symphonia::core::audio::AudioBufferRef,
    _sample_rate: u32,
    channels: u16,
) -> Result<u64, String> {
    use symphonia::core::audio::{AudioBufferRef, Signal};
    use symphonia::core::sample::Sample;

    let frames = decoded.frames() as u64;
    let ch = channels as usize;
    let mut interleaved = Vec::with_capacity(frames as usize * ch);

    match decoded {
        AudioBufferRef::F32(buf) => {
            for i in 0..buf.frames() {
                for c in 0..ch.min(buf.spec().channels.count()) {
                    interleaved.push(buf.chan(c)[i]);
                }
            }
        }
        AudioBufferRef::S16(buf) => {
            for i in 0..buf.frames() {
                for c in 0..ch.min(buf.spec().channels.count()) {
                    interleaved.push(buf.chan(c)[i] as f32 / i16::MAX as f32);
                }
            }
        }
        AudioBufferRef::S24(buf) => {
            for i in 0..buf.frames() {
                for c in 0..ch.min(buf.spec().channels.count()) {
                    interleaved.push(buf.chan(c)[i].clamped().inner() as f32 / 8_388_608.0);
                }
            }
        }
        AudioBufferRef::S32(buf) => {
            for i in 0..buf.frames() {
                for c in 0..ch.min(buf.spec().channels.count()) {
                    interleaved.push(buf.chan(c)[i] as f32 / i32::MAX as f32);
                }
            }
        }
        _ => return Err("Unsupported decoded sample format".to_string()),
    }

    match output {
        PlaybackOutput::Cpal(o) => {
            o.tx.send(interleaved).map_err(|e| e.to_string())?;
        }
    }

    Ok(frames)
}
