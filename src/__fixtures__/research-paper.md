# Loudness Normalisation in Local-First Media Players

## Abstract

Loudness normalisation is widely deployed by streaming services, yet local-first
players frequently ship inconsistent implementations. This paper surveys the
practical trade-offs between ReplayGain tags, EBU R128 measurement, and
peak-based approximations (Smith et al., 2019).

## Introduction

Playback loudness varies by more than 12 dB across typical libraries. Listeners
compensate manually, which defeats the purpose of an unattended queue. Prior work
established the EBU R128 target of -23 LUFS for broadcast and -14 LUFS for
streaming (Jones and Patel, 2021).

A common failure is to conflate *peak* level with *loudness*. Peak is a property
of a single sample; loudness is an integral over time. Substituting one for the
other inverts the correction: quiet material is attenuated further.

## Method

We measured 400 tracks across three sources. Each was analysed with a reference
R128 implementation and with a simple RMS estimator over the first six megabytes.

## Results

The RMS estimator tracked the reference within 2.1 dB for 88% of material.
Divergence concentrated in wide-dynamic-range classical recordings.

## Conclusion

An RMS proxy is adequate where tags are absent, provided peak headroom is
respected so that positive gain cannot clip.

## References

Jones, A. and Patel, R. (2021). Loudness targets for streaming. Journal of Audio
Engineering, 69(4), 210-225.

Smith, J., Kaur, P. and Okafor, N. (2019). ReplayGain in practice. Proceedings of
the Audio Workshop, 44-51.
