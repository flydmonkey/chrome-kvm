use kvm_core::media::{H264Encoder, RawFrame, TestPatternSource};
use kvm_core::media::source::FrameSource;

#[test]
fn encodes_test_pattern_to_annex_b() {
    let src = TestPatternSource::new(320, 180);
    let frame = src.next_frame().expect("frame");
    let enc = H264Encoder::new(320, 180).expect("encoder");
    let au = enc.encode_frame(&frame).expect("encode");
    assert!(au.len() > 32, "bitstream too small: {}", au.len());
    // Annex-B start code 00 00 00 01 or 00 00 01
    let has_sc = au.windows(4).any(|w| w == [0, 0, 0, 1])
        || au.windows(3).any(|w| w == [0, 0, 1]);
    assert!(has_sc, "missing annex-B start code");
    let _ = RawFrame {
        width: frame.width,
        height: frame.height,
        rgba: frame.rgba,
    };
}
