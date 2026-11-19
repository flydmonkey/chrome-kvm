//! H264 via ffmpeg (NVENC/QSV/AMF/libx264). Prefer HW when `prefer_gpu`.

use std::io::{Read, Write};
use std::process::{Command, Stdio};

use anyhow::{anyhow, bail, Context, Result};
use tracing::info;

use super::capture::ffmpeg_bin;
use super::frame::RawFrame;

pub fn pick_ffmpeg_h264_encoder(prefer_gpu: bool) -> Option<&'static str> {
    let bin = ffmpeg_bin()?;
    let out = Command::new(&bin)
        .args(["-hide_banner", "-encoders"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    if prefer_gpu {
        for name in ["h264_nvenc", "h264_qsv", "h264_amf", "h264_mf"] {
            if text.contains(name) {
                return Some(name);
            }
        }
    }
    if text.contains("libx264") {
        return Some("libx264");
    }
    None
}

pub struct FfmpegH264Encoder {
    width: u32,
    height: u32,
    fps: u32,
    codec: String,
    bin: String,
}

impl FfmpegH264Encoder {
    pub fn open(width: u32, height: u32, fps: u32, prefer_gpu: bool) -> Result<Self> {
        let w = width.max(2) & !1;
        let h = height.max(2) & !1;
        let codec = pick_ffmpeg_h264_encoder(prefer_gpu)
            .ok_or_else(|| anyhow!("no ffmpeg h264 encoder"))?
            .to_string();
        let bin = ffmpeg_bin().ok_or_else(|| anyhow!("ffmpeg not found"))?;
        info!(%codec, width = w, height = h, "ffmpeg H264 encoder ready");
        Ok(Self {
            width: w,
            height: h,
            fps: fps.max(1),
            codec,
            bin,
        })
    }

    pub fn codec(&self) -> &str {
        &self.codec
    }

    pub fn encode_frame(&self, frame: &RawFrame) -> Result<Vec<u8>> {
        let expected = (self.width as usize) * (self.height as usize) * 4;
        if frame.rgba.len() < expected {
            bail!("frame too small");
        }

        let mut cmd = Command::new(&self.bin);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            .arg("-s")
            .arg(format!("{}x{}", self.width, self.height))
            .arg("-r")
            .arg(self.fps.to_string())
            .arg("-i")
            .arg("pipe:0")
            .arg("-frames:v")
            .arg("1")
            .arg("-an")
            .arg("-c:v")
            .arg(&self.codec);
        if self.codec == "libx264" {
            cmd.args(["-preset", "ultrafast", "-tune", "zerolatency"]);
        } else if self.codec == "h264_nvenc" {
            cmd.args(["-preset", "ll", "-delay", "0"]);
        }
        cmd.args(["-f", "h264", "pipe:1"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = cmd.spawn().context("spawn ffmpeg encode")?;
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or_else(|| anyhow!("ffmpeg stdin"))?;
            stdin.write_all(&frame.rgba[..expected])?;
        }
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("ffmpeg stdout"))?;
        let mut out = Vec::new();
        stdout.read_to_end(&mut out)?;
        let status = child.wait()?;
        if !status.success() {
            bail!("ffmpeg encode failed: {status}");
        }
        if out.is_empty() {
            bail!("ffmpeg produced empty bitstream");
        }
        Ok(out)
    }
}
