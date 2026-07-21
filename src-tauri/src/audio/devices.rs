use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub sample_rate_hz: Option<u32>,
    pub channels: Option<u16>,
    pub exclusive_supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDevicesResponse {
    pub platform: String,
    pub exclusive_available: bool,
    pub devices: Vec<AudioOutputDevice>,
}

pub fn list_output_devices() -> Result<ListDevicesResponse, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok());

    let mut devices = Vec::new();
    let output_devices = host.output_devices().map_err(|e| e.to_string())?;

    for device in output_devices {
        let name = device.name().map_err(|e| e.to_string())?;
        let id = name.clone();
        let is_default = default_name.as_ref() == Some(&name);

        let (sample_rate_hz, channels) = device
            .default_output_config()
            .ok()
            .map(|cfg| (Some(cfg.sample_rate().0), Some(cfg.channels())))
            .unwrap_or((None, None));

        devices.push(AudioOutputDevice {
            id,
            name,
            is_default,
            sample_rate_hz,
            channels,
            exclusive_supported: cfg!(windows),
        });
    }

    let platform = std::env::consts::OS.to_string();
    let exclusive_available = cfg!(windows);

    Ok(ListDevicesResponse {
        platform,
        exclusive_available,
        devices,
    })
}
