//! LCUS USB serial relay protocol (aligned with `atx-relay.js`).

pub const BAUD_RATE: u32 = 9600;
pub const SHORT_PRESS_MS: u64 = 500;
pub const LONG_PRESS_MS: u64 = 6000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PressKind {
    Short,
    Long,
    Reset,
}

impl PressKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "short" => Some(Self::Short),
            "long" => Some(Self::Long),
            "reset" => Some(Self::Reset),
            _ => None,
        }
    }

    pub fn duration_ms(self) -> u64 {
        match self {
            Self::Short | Self::Reset => SHORT_PRESS_MS,
            Self::Long => LONG_PRESS_MS,
        }
    }
}

/// LCUS: `A0 channel state checksum` where checksum = (A0+channel+state) & 0xFF.
pub fn command(channel: u8, on: bool) -> [u8; 4] {
    let state = if on { 1u8 } else { 0u8 };
    let sum = (0xA0u16 + channel as u16 + state as u16) as u8;
    [0xA0, channel, state, sum]
}

pub fn normalize_channel(value: u8) -> u8 {
    if (1..=4).contains(&value) {
        value
    } else {
        1
    }
}
