use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use anyhow::Result;

use super::frame::RawFrame;

pub trait FrameSource: Send + Sync {
    fn next_frame(&self) -> Result<RawFrame>;
    fn label(&self) -> &str;
}

pub struct TestPatternSource {
    width: u32,
    height: u32,
    tick: AtomicU64,
    started: Instant,
}

impl TestPatternSource {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            tick: AtomicU64::new(0),
            started: Instant::now(),
        }
    }
}

impl FrameSource for TestPatternSource {
    fn label(&self) -> &str {
        "test-pattern"
    }

    fn next_frame(&self) -> Result<RawFrame> {
        let t = self.tick.fetch_add(1, Ordering::Relaxed);
        let phase = self.started.elapsed().as_secs_f32();
        let w = self.width as usize;
        let h = self.height as usize;
        let mut rgba = vec![0u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let bar = ((x as f32 / 40.0) + phase * 2.0) as u32;
                let r = if bar % 3 == 0 { 220 } else { 40 };
                let g = if bar % 3 == 1 { 200 } else { 40 };
                let b = if bar % 3 == 2 { 220 } else { 40 };
                // moving cursor block
                let cx = ((phase * 120.0) as usize + (t as usize / 2)) % w.max(1);
                let cy = h / 2;
                let in_cursor = x.abs_diff(cx) < 8 && y.abs_diff(cy) < 8;
                if in_cursor {
                    rgba[i] = 255;
                    rgba[i + 1] = 255;
                    rgba[i + 2] = 0;
                } else {
                    rgba[i] = r;
                    rgba[i + 1] = g;
                    rgba[i + 2] = b;
                }
                rgba[i + 3] = 255;
            }
        }
        Ok(RawFrame {
            width: self.width,
            height: self.height,
            rgba,
        })
    }
}
