#[derive(Clone)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    /// RGBA8 packed.
    pub rgba: Vec<u8>,
}

impl RawFrame {
    pub fn to_jpeg(&self, quality: u8) -> anyhow::Result<Vec<u8>> {
        use image::{codecs::jpeg::JpegEncoder, ColorType, ImageEncoder};
        let rgb: Vec<u8> = self
            .rgba
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        let mut out = Vec::new();
        let enc = JpegEncoder::new_with_quality(&mut out, quality);
        enc.write_image(&rgb, self.width, self.height, ColorType::Rgb8.into())?;
        Ok(out)
    }
}
