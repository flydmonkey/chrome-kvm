English | [简体中文](README.md)

### Introduction

Chrome-KVM is a BIOS-level remote control project built on the Chrome browser. Just open a web page to manage a server or workstation — no software to install and no settings to change on the target PC. Control is completely non-intrusive, so it works in a wide range of situations.

The interface is available in Simplified Chinese, Traditional Chinese, English, Japanese and Korean. On first use it follows your browser language (falling back to English), and you can change it at any time at the top of the settings page.

![Intro](./docs/intro.png)

### Features

The table below compares Chrome-KVM with several common KVM solutions. It is not meant to promote or disparage anyone. Information about the other projects is taken from their official materials as of October 2026; "Unknown" means we couldn't find a definitive statement. If anything is wrong or missing, please let us know.

|              Feature              |    One-KVM    |           PiKVM           |   ArmKVM    |     JetKVM     |     NanoKVM      |       Openterface        |      Chrome KVM       |
|:---------------------------------:|:-------------:|:-------------------------:|:-----------:|:--------------:|:----------------:|:------------------------:|:---------------------:|
|               Type                | Network IP-KVM |      Network IP-KVM      | Network IP-KVM | Network IP-KVM | Network IP-KVM |      USB direct        |      USB direct       |
|     Remote control over network   |       √       |             √             |      √      |       √        |        √         |            x             |           x           |
| No KVM box permanently beside the target PC |  x  |             x             |      x      |       x        |        x         |            √             |           √           |
|          Open-source system       |       √       |             √             |      √      |       √        |        √         |            √             |           √           |
|   Simplified Chinese interface    |       √       |             x             |      √      |    Unknown     |        √         |         Unknown          |           √           |
|          Video transport          |  MJPEG/H.264  |        MJPEG/H.264        | MJPEG/H.264 | H.264 (WebRTC) |   MJPEG/H.264    | USB direct, no encoding  | USB direct, no encoding |
|        H.264 video encoding       |      CPU      |            GPU            |   Unknown   |    Hardware    |     Hardware     |            —             |           —           |
|               Audio               |       √       |             √             |      √      | √ (experimental) | x (√ on Pro)   |       √ (local)          |       √ (local)       |
|      Keyboard & mouse control     |  OTG/CH9329   | OTG/CH9329/Pico/Bluetooth |     OTG     |      OTG       |       OTG        |     CH9329/CH32V208      |        CH9329         |
|            VNC control            |       √       |             √             |      √      |    Unknown     |     Unknown      |            x             |           x           |
|          ATX power control        | GPIO/USB relay |          GPIO            |    GPIO     | ATX extension board |     √       |            x             |       USB relay       |
|    Virtual storage drive mount    |       √       |             √             |      √      |       √        |        √         | x (can switch a physical USB drive) |  x         |
|     CD-ROM mount larger than 2.2G |       x       |             x             |      √      |    Unknown     |     Unknown      |            x             |           x           |
|         Wake-on-LAN (WOL)         |       √       |             √             |      √      |       √        |        √         |            x             |           x           |
|     Paste text to the target PC   |       √       |             √             |      √      |       √        |     Unknown      |         Unknown          |    √ (ASCII only)     |
|       OCR text recognition        |       √       |             √             |      √      |    Unknown     |     Unknown      |            √             | √ (EN / zh-Hans / zh-Hant) |
|           Web terminal            |       √       |             √             |      √      |    Unknown     |        √         |            x             |           x           |
|          Serial terminal          |       x       |             x             |      √      | Serial extension board | √ (2 ports) |          √             |           x           |
|        HDMI switch support        |       √       |             √             |      √      |    Unknown     |     Unknown      |            x             |           x           |
|          Video recording          |       √       |             x             |      x      |    Unknown     |     Unknown      |            √             |   √ (saved locally)   |
|         Docker deployment         |       √       |             x             |      x      |       x        |        x         |            x             |           x           |
| Official commercial product       |       x       |             √             |      √      |       √        |        √         |            √             |           x           |
| No software install on controller |       √       |             √             |      √      |       √        |        √         |       x (client app)     |   √ (Chrome/Edge)     |
|         Technical support         |       √       |             √             |      √      |       √        |        √         |            √             |           √           |

How the two kinds of solutions differ:

- **Network IP-KVM** (One-KVM, PiKVM, ArmKVM, JetKVM, NanoKVM) keeps a small computer permanently next to the target PC. It captures and encodes the video and streams it over the network, so you can control the machine from a browser anywhere. Keyboard and mouse are usually emulated over USB OTG, which can also emulate USB drives and CD-ROMs, so you can install an OS remotely.
- **USB direct** (Openterface, Chrome-KVM) turns the computer in front of you into the target PC's monitor, keyboard and mouse: a capture card brings the video in, and a CH9329 sends keyboard and mouse input out. No extra KVM box is needed, the video is never encoded or sent over a network so latency is low, and the hardware costs only a few dollars. The trade-off is that you have to be next to the target PC, and the CH9329 can only act as a keyboard and mouse — it can't mount a virtual CD-ROM. The difference between Chrome-KVM and Openterface is that Chrome-KVM works by just opening a web page; there's no client to install.

Good use cases for Chrome-KVM:

- Carry it around and plug it into a machine on the spot to enter the BIOS, install drivers, read a blue-screen error, or work on a headless server or industrial PC
- The target PC has no network, or it's inconvenient to set one up
- You switch between different computers as the controller and don't want to install a client on each one

Not a good fit — for these, we recommend One-KVM (cheap boards such as Orange Pi or OneCloud are enough) or NanoKVM:

- Controlling machines in a server room over the network
- Mounting an ISO to install an OS remotely (the CH9329 can only act as a keyboard and mouse; it can't emulate a CD-ROM)
- Wake-on-LAN or 24/7 always-on access

### Hardware

1. A controller computer with the Chrome browser installed
2. A USB video capture card
3. A CH9329 remote keyboard/mouse controller
4. A target PC
5. (Optional) An LCUS-series USB serial relay to press the power button remotely; see "ATX power" below

### Quick start

1. Open this site: [Settings page](https://flydmonkey.github.io/chrome-kvm/settings.html)
2. Authorize the video capture card
   ![Intro](./docs/1.jpg)
3. Authorize the keyboard/mouse controller
4. Select the USB capture card as the video device (usually its name contains "USB Video")
5. Select the USB capture card as the audio device (usually its name contains "USB Audio")
6. Select the serial device (usually its name contains "wch")
![3.png](docs/3.jpg)
7. Click "Save", then click "Back to control page", and you can control the PC
   ![Intro](./docs/2.jpg)
8. Start the system and play audio and video
![Intro](./docs/4.jpg)

### Toolbar

Along the left edge of the control page there is a collapsible toolbar. When collapsed, only a small handle remains at the edge of the screen; click it to expand. From top to bottom, the buttons fall into four groups:

| Icon                     | What it does                                                                          |
|:-------------------------|:--------------------------------------------------------------------------------------|
| Video camera             | Video status. Hover to see resolution and frame rate; click to refresh or reopen capture |
| Keyboard and mouse       | Keyboard/mouse status. Hover to see firmware and USB enumeration; click to refresh or reconnect |
| 1 A ⇩                    | The target PC's Num / Caps / Scroll Lock indicators. Green means on; click to toggle    |
| Four outward corners     | Fullscreen. The icon changes to inward corners and system keys like Win and Alt+Tab are captured |
| Filled circle            | Record the current picture. Turns into a red square while recording; a webm file downloads when you stop |
| Camera                   | Take a screenshot at the capture card's native resolution, download it as PNG and copy it to the clipboard |
| Viewfinder with a T      | Select an area of the picture to recognize text (OCR); see below                      |
| Magnifier                | Display mode: fit to window, stretch, 1:1, zoom; see below                            |
| Monitor and phone        | Switch target PC profile. Only appears when you have two or more profiles; see below  |
| Four squares             | Open the shortcut panel: Ctrl+Alt+Delete and other common combos, force-release all keys, and the on-screen keyboard; see below |
| Clipboard                | Type the text on your local clipboard into the target PC, one character at a time     |
| Power symbol             | ATX power: press the power button, force shutdown, press reset. Only appears when a relay is selected on the settings page; see below |
| Gear                     | Open the settings page                                                                |
| Two-way arrow            | Reload the page                                                                       |
| Angle bracket            | Collapse or expand the toolbar                                                        |

The two status icons share one color scheme: gray means not connected, green means everything is fine, yellow means working but with a problem, and red means disconnected.

For video status, yellow means the capture card has no input signal or hasn't received the first frame yet. Red means capture was interrupted (usually because the capture card was unplugged) or failed to open; hover to see the exact reason, and click to reopen. If you unplug the capture card and plug it back in, the picture recovers automatically without reloading the page. Gray with "No video device selected" means you haven't selected a capture card on the settings page yet — keyboard and mouse still work in this state, which is handy when you only need to press a few keys blind.

Messages such as connection errors and paste results appear in a notification bar at the top of the picture instead of in dialogs. Dialogs steal focus, which causes every key currently held on the target PC to be released. Normal notifications disappear after a few seconds; error notifications stay until you close them, so you have time to read the details.

When you click Save on the settings page in another tab, any open control page applies the new settings automatically without a reload: sensitivity takes effect immediately, changing the capture card, resolution or frame rate reopens the video, and changing the serial device or mouse mode reconnects the keyboard and mouse.

The "Capture frame rate" setting on the settings page defaults to letting the browser decide, in which case Chrome only asks for 30fps. If your capture card supports 60fps, choosing 60 feels more responsive. Many capture cards only do 30fps at 1080p; in that case it automatically falls back to 30, since resolution takes priority. Hover over the video status icon to see the frame rate you actually got.

For keyboard/mouse status, yellow can mean the target PC hasn't enumerated the USB device, the target PC is asleep, or the chip kept failing to respond and has been downgraded to send-only mode (no waiting for replies). Red means the serial port is disconnected. If you unplug the CH9329 and plug it back in, it reconnects automatically; you can also click the icon to retry immediately.

The three small lights below the keyboard/mouse status are the target PC's Num Lock, Caps Lock and Scroll Lock indicators; green means on. Your local keyboard's lights are not synced with the target PC, so glance here before typing to know the Caps Lock and numpad state. The control page queries the chip every 2 seconds, and refreshes immediately when you press a lock key. Clicking a light presses the corresponding lock key on the target PC. The lights are hidden when the target PC hasn't enumerated the USB device; when the chip is in send-only mode, querying stops and the lights stay at their last known state.

Paste works by simulating keystrokes, so it only supports characters that can be typed directly on a US keyboard. Chinese and other characters are skipped, and you're told how many were skipped at the end. Before pasting, the target PC's Caps Lock indicator is checked; if it's on, it's turned off first so you don't end up with all capitals. Progress is shown at the top while pasting; click "Cancel" in the notification or click the paste button again to stop partway. Keyboard input is not forwarded during this time, so it doesn't get mixed up with the characters being typed.

### Shortcut panel

Outside fullscreen, key combinations like Win+L and Alt+Tab are intercepted by your local computer first, and some keys (SysRq, Pause) simply don't exist on your keyboard. The four-squares button on the toolbar opens the shortcut panel; click a shortcut to send that combination to the target PC, and all keys are released automatically afterwards.

The top of the panel has two action buttons: "Force release all keys" rescues you when a key is stuck on the target PC, and "On-screen keyboard" only appears on touch devices; see below.

The panel comes with several preset groups:

- **Windows**: Ctrl+Alt+Delete (security options), Start menu, lock screen, show desktop, Run, Task Manager, Alt+Tab, Alt+F4, etc.
- **macOS**: Cmd+Space, Cmd+Tab, Force Quit, lock screen, etc. (Cmd is the Win key)
- **Linux**: Ctrl+Alt+T to open a terminal, Ctrl+Alt+F1–F7 to switch TTYs
- **Boot / BIOS**: Del, F2, F12, F11, F8, Esc
- **Other**: PrintScreen, Pause, ScrollLock, NumLock, Menu key

**Repeat at boot**: The BIOS only accepts hotkeys for a second or two during POST, which is hard to hit by hand. Check "Repeat at boot" and then click a key in the boot group; it will be pressed every 0.2 seconds for up to 60 seconds. Turn on repeat first and then power on the target PC, and you won't miss the window. Click "Stop" in the notification bar or click any shortcut to stop. Keyboard input is not forwarded while repeating.

**Custom shortcuts**: At the bottom of the panel you can add your own shortcuts, saved in your local browser. Join keys pressed together with `+` and separate steps with spaces, e.g. `Win+R Enter`. Write modifiers as Ctrl, Shift, Alt, Win; if you're used to a Mac, Cmd and Option also work.

### Text recognition (OCR)

When you want to copy an error code, IP address or log from the target PC's screen back to your own computer, click the viewfinder button on the toolbar, drag a box over the picture, and recognition starts when you release. The recognized text appears in a panel where you can edit it before copying; it's also copied to the clipboard automatically. "Whole screen" in the panel recognizes the full picture, and "Select again" lets you box another area. While selecting, mouse and keyboard input is not sent to the target PC; press Esc or right-click to cancel.

- **Languages**: English, Simplified Chinese and Traditional Chinese are supported. Check them in the panel; the default is English plus Simplified Chinese. Changing the selection re-recognizes the last area with the new languages. When both Chinese and English are checked and the result contains Chinese characters, it's automatically recognized again with Chinese prioritized; pure-English screens are unaffected
- **Fully local recognition**: The engine is [Tesseract.js](https://github.com/naptha/tesseract.js), stored together with the three language packs in the repository's `vendor/tesseract/`. It works without internet access, and the picture is never uploaded anywhere. The first recognition needs to load the engine, which takes about a second; memory is released automatically after three minutes of inactivity
- **Dark backgrounds**: Light text on a dark background, as in the BIOS or a terminal, is inverted before recognition, which noticeably improves accuracy

Limitations: Recognition relies on the captured picture, so very small text, very thin fonts or a blurry picture lead to mistakes — commonly 0 vs. O, l vs. 1, and lost underscores. The layout of tables and multi-column text is not preserved; text is output line by line. The tighter your box around the text, the better the accuracy.

### Display

The magnifier button on the toolbar switches how the picture is displayed; your choice is saved in your local browser:

- **Fit to window** (default): Scaled proportionally and shown in full, with black bars filling the extra space
- **Stretch to fill**: Fills the window; the picture is distorted if the aspect ratio doesn't match
- **Native pixels 1:1**: One picture pixel maps to one screen pixel, for the sharpest text; when the picture is larger than the window, it pans with the mouse
- **Zoom 150% / 200% / 300%**: Zoomed in from fit-to-window so you can read small text; the picture follows the mouse, showing the part of the picture that corresponds to where the mouse is in the window

In 1:1 and zoom modes, your local pointer and the target PC's pointer always line up — what you click is what gets clicked. The picture doesn't pan while the pointer is locked (relative mode).

### Multiple target PCs

If you switch one capture card and CH9329 between several machines, or have several sets of devices, you can save each machine's settings separately under "Target PC profiles" at the top of the settings page:

1. On the settings page, choose this machine's capture card, serial port, resolution and mouse mode
2. Click "Save current form as…" and give it a name
3. From then on, selecting a profile in the dropdown switches to it; clicking "Save" while a profile is selected also updates that profile

With two or more profiles saved, a switch button appears on the control page's toolbar. Click it to reopen the capture card and keyboard/mouse with that profile, without going back to the settings page. Baud rate and chip working mode reflect the CH9329 chip's own state, so they don't change with the profile.

The relay is also part of the profile. When you switch to a profile without a relay configured, the power button disappears instead of reusing the previous machine's relay, so you won't accidentally shut down a different machine.

### ATX power

Once the target PC has crashed or shut down, the keyboard and mouse can't help anymore. Connect a USB serial relay to the case's power button and you can press the power button remotely from the control page: power on, shut down the OS, or long-press to force power off.

#### How it works

The power button on a PC case is just a momentary switch; pressing it briefly shorts two pins (PWR_SW) on the motherboard's front-panel header. The relay contacts are wired in parallel with it: closing the relay is the same as pressing the power button, and opening it is the same as letting go. These two pins only carry a few volts of standby voltage and very little current, so any small relay will do.

```
                     Motherboard front-panel header
                     ┌─────────────────────┐
                     │  PWR_SW+   PWR_SW-  │
                     └────┬──────────┬─────┘
                          │          │
              ┌───────────┴─┐      ┌─┴───────────┐
              │ 1-to-2 Dupont│      │ 1-to-2 Dupont│
              └──┬───────┬──┘      └──┬───────┬──┘
                 │       │            │       │
      Case power-btn   Relay COM   Case power-btn   Relay NO
      wire (as before)             wire (as before)

    Controller PC ══ USB ══ LCUS relay (COM / NO terminals)
```

#### What you need

- **LCUS-1 USB serial relay** (search Taobao for "LCUS-1 USB 继电器"; it costs a couple of dollars). A single channel is enough; multi-channel boards also work — pick the channel you wired on the settings page.
  - Get the **serial version** (the board has a CH340 chip and shows up as a new COM port / `ttyUSB` when plugged in); its commands look like `A0 01 01 A2`.
  - **The driverless HID version won't work**: it doesn't show up as a serial port, so the browser's Web Serial can't open it.
- **Two 1-female-to-2-male Dupont cables**: the female end goes onto the motherboard pin, one male end takes the case power button's original wire, and the other male end is screwed into the relay's terminal. This connects both the case power button and the relay to those two pins, so the case power button keeps working. If you don't have these, twisting the wires together and wrapping them with tape also works.
- A USB cable long enough to connect the relay to the controller PC. The relay is powered by USB alone; no separate power supply is needed.

#### Wiring

1. **Shut down the target PC and unplug its power cord first**, then open the case.
2. Find the front-panel header, usually in the lower-right corner of the motherboard, labeled `F_PANEL`, `JFP1` or `PANEL1`. The two pins marked `PWR_SW`, `PWRBTN` or `PW+ PW-` on the silkscreen or in the manual are the power button. Don't mix them up with the neighboring `RESET`, `HDD_LED` or `PLED`.
3. Pull the case power button's wire off these two pins and plug in the 1-to-2 Dupont cables instead. One branch takes the case power button's wire back; the other goes to the relay's `COM` and `NO` (normally open) terminals. Tighten the screws.
   - **The power button has no polarity**, so swapping the two wires is fine.
   - **Don't use `NC` (normally closed)**: that would be the same as holding the power button down all the time, and the machine either won't start or will shut itself off.
4. Route the wires out through a gap in the case or an empty PCI slot cover, close the case, and plug the power cord back in. Press the case power button once to make sure the original button still works.

**Wiring the reset button too (optional)**: With a 2- or 4-channel relay, you can wire another channel's `COM` and `NO` in parallel to the `RESET` pins (sometimes labeled `RST` or `RESET_SW`) the same way, and press the reset button remotely from the control page. The reset button also has no polarity — don't use `NC`. Many newer cases no longer have a reset button and the `RESET` pins are empty; just connect Dupont wires directly.

#### Enabling it on the page

1. Plug the relay into a USB port on the controller PC.
2. Open the settings page, click "Authorize relay" in the "ATX power" section, and select it in the popup list. It doesn't matter if it has the same name as the CH9329; either one is fine.
3. Select it under "Relay serial port", and under "Relay channel" select the channel wired to the power button (channel 1 for a single-channel relay). If you wired the reset button, select that channel under "Reset button channel"; otherwise leave it at "No reset button". Click "Save".
4. Go back to the control page; a power icon now appears above "Settings" on the toolbar. Click it to open the power panel.

Before wiring it to the target PC, you can do a dry run: with the relay not yet wired, click "Press the power button". You should hear two clicks, and the indicator on the board lights up for half a second and goes out. If you hear that, the serial port and commands are working.

#### Buttons in the panel

- **Press the power button**: Closes the relay for 0.5 seconds and releases it, just like pressing the case power button once. If the machine is off, it powers on; if it's on, the OS handles it according to its own "power button" setting, usually a normal shutdown or sleep.
- **Hold the power button to force shutdown**: Closes the relay for 6 seconds. The motherboard forces power off after the button is held for about 4 seconds — the same as pulling the power cord, so unsaved work is lost. Only use it when the machine is frozen. To prevent accidents, you must **click twice**: the first click turns the button red and shows "Click again to confirm force shutdown", and only a second click within 4 seconds actually presses it. While it's held, the notification bar at the top shows "Release", which lets you let go early.
- **Press the reset button**: Only appears when a reset channel is configured. Closes the relay for 0.5 seconds and the target PC restarts immediately, without an OS shutdown, so unsaved work is lost. Like force shutdown, it needs two clicks to confirm. When the machine is frozen, it's faster than "force shutdown, then power on" — one step and done.

All buttons are grayed out while a press is in progress, and the result is shown at the top when it's done.

#### Telling it apart from the CH9329

The relay and the CH9329 usually both use a CH340 USB-to-serial chip, so the browser sees exactly the same vendor and product IDs and can't tell them apart. The control page handles this by **excluding the port currently in use as the keyboard/mouse** from the ports of that model; whatever remains is the relay. So:

- When the keyboard/mouse is connected (keyboard/mouse status is green), the power button always uses the other serial port.
- When the keyboard/mouse is not connected and there are two openable serial ports of the same model plugged in, you'll get a message that the relay can't be identified, and **no command is sent**. Get the keyboard/mouse connected first, or unplug the extra serial device.

The relay is only opened for the moment of the press and closed right after, so it doesn't hold the serial port the rest of the time and doesn't get in the way of other programs.

#### Multiple target PCs

The relay is part of the "Target PC profile", so each machine can have its own relay. When you switch to a profile without a relay configured (including old profiles saved before this feature existed), the power button disappears instead of reusing the previous machine's relay, so you won't accidentally shut down a different machine.

#### FAQ

- **There's no power button on the toolbar**: "Relay serial port" on the settings page is set to "None", or the current target PC profile has no relay configured. Remember to click "Save" after choosing one.
- **There's no "Press the reset button" in the panel**: "Reset button channel" on the settings page is still "No reset button". It also can't be the same channel as the power button; selecting the power button's channel automatically reverts it to "No reset button".
- **"Relay serial port not found"**: The relay isn't plugged in properly, or it hasn't been authorized for this URL yet. Browser device permissions are remembered per URL; if you change URL (for example from localhost to the public site), you need to authorize it again.
- **"Can't open the relay serial port"**: Another tab or program is using it, such as a serial terminal tool. Close it and try again; if that doesn't help, unplug and replug the relay.
- **The relay clicks but the target PC doesn't respond**: Most likely the wrong pins. Check the motherboard manual to make sure it's the two `PWR_SW` pins, and that you used `COM` and `NO`. Also check that the switch on the back of the power supply is on.
- **Power-on works, but a short press doesn't shut down**: That's a setting on the target PC's OS. On Windows, go to "Control Panel → Power Options → Choose what the power buttons do" and set "When I press the power button" to "Shut down". On Linux desktops it's usually in the power settings; on servers, see `HandlePowerKey` in `/etc/systemd/logind.conf`.
- **I accidentally closed the page during a long press**: The relay stays closed, which is the same as holding the power button down. Unplug and replug the relay's USB cable to release it; it always opens when it loses power.
- **The relay can't be opened on a Linux controller**: As with the CH9329, you need to grant serial port permissions, e.g. `sudo chmod 666 /dev/ttyUSB1`, or add your user to the `dialout` group and log in again.

### Touch screens

When you open the control page on a tablet or touchscreen laptop, your fingers work directly as a mouse:

| Gesture                  | Absolute mode                                | Relative mode (touchpad feel)                      |
|:-------------------------|:---------------------------------------------|:---------------------------------------------------|
| One-finger tap           | Left-click where you tap                     | Left-click                                         |
| One-finger long press    | Right-click where you press                  | Hold the left button; slide afterwards to drag     |
| One-finger slide         | Left-drag starting from where you pressed    | Move the pointer                                   |
| Two-finger tap           | Right-click                                  | Right-click                                        |
| Two-finger vertical slide | Scroll wheel (natural scrolling direction)  | Scroll wheel (natural scrolling direction)         |

On touch devices, the top of the shortcut panel gets an extra "On-screen keyboard" button. Tap it to close the panel and bring up the system soft keyboard; what you type is sent to the target PC character by character, and Backspace, Enter and the arrow keys work too. As with paste, only characters that can be typed directly on a US keyboard are supported; send combinations like Win+L with the shortcut panel.

### System shortcuts

Keys like Win, Alt+Tab, Esc and Ctrl+W are normally intercepted by your local browser and OS and never reach the target PC. Click the fullscreen button on the toolbar, and in fullscreen the page uses Chrome's Keyboard Lock to intercept all of them and forward them — pressing Win opens the target PC's Start menu, and Alt+Tab switches the target PC's windows.

To exit fullscreen, **hold Esc for two seconds**. This is an escape hatch Chrome always keeps; a short press of Esc is still sent to the target PC as usual, which is exactly what you need in the BIOS.

This only works for fullscreen entered with the button. Fullscreen entered with F11 doesn't go through the Fullscreen API, so keyboard lock doesn't take effect. Hover over the fullscreen button to see whether it says "System shortcuts captured" or "System shortcuts not captured".

### Large movements in relative mode

The protocol limits a relative move to ±127 per packet, yet in testing a single quick flick can request well over a thousand units. Simply truncating would lose more than 80% of the distance — the symptom being "I flick the mouse and the target PC's cursor barely moves."

So moves larger than 127 are **split into multiple packets and sent back to back right away** (capped at `Ch9329.MAX_MOVE_BURST`, 16 packets or 2032 units by default), rather than truncated or held over to be sent gradually over the following frames — holding them over would make the cursor keep gliding after your hand has stopped. Only the remainder beyond the cap is carried to the next frame, so no total movement is lost.

This relies on the link having headroom. In testing, a packet round trip at 1Mbps takes about 0.34ms, while `mousemove` events arrive about 29ms apart, so more than eighty packets fit into one event interval; a burst of a dozen or so packets takes just a few milliseconds.

When the browser supports it, the control page reads mouse movement from `pointerrawupdate` instead, which fires at the mouse hardware's polling rate rather than once per frame like `mousemove`, so input is sent as soon as your hand moves. Denser events don't flood the serial port either: queued relative moves are accumulated into the same packet (no total movement lost), and for absolute coordinates only the latest one is kept. If you set the baud rate very low (e.g. back to 9600, with round trips of 20ms or more), bursts will clearly fall behind, and you should lower `MAX_MOVE_BURST` instead.

To see how your own setup actually performs, run this in the control page's console:

```js
ch.resetMoveStats()   // reset, then use the mouse normally for a while
ch.reportMoveStats()  // view the results
```

The report keys are in Chinese. `被合并丢弃` (dropped by merging) only appears in absolute mode; if it isn't 0, the serial port can't keep up with your hand and you should raise the baud rate. In relative mode the equivalent is `相对位移合并次数` (relative moves merged); merging just combines several moves into one packet and loses no distance. `拆包连发次数` (split bursts) and `单轴最大请求位移` (max requested movement per axis) show how hard you flick the mouse. If `余量推迟次数` (remainders deferred) isn't 0, you hit the burst cap.

### Relative mode feels slow

With the pointer locked, the page receives **raw mouse counts without local acceleration** (`unadjustedMovement: true`) and sends them to the target PC as-is. That's the right thing for a KVM to do — accelerating locally would stack on top of the target PC's own acceleration and make the feel completely unpredictable — but the side effect is that it feels noticeably slower than your usual desktop: normally the OS's acceleration amplifies movement when you move quickly, and here that's deliberately turned off.

There are two ways to compensate; try the one that doesn't require code changes first:

1. **Raise the pointer speed on the target PC**. The downside is that it changes a global setting on that machine, and you'll have to adjust it again on every other target PC.
2. **"Relative mode sensitivity" on the settings page** (default 1). It travels with the KVM and applies to every target PC. After saving, it takes effect immediately on any open control page.

   To tweak it while trying out the feel, you can change it directly in the control page's console; it takes effect immediately without a reload:

   ```js
   Ch9329.RELATIVE_SPEED = 1.8
   ```

   Once you've found a good value, enter it on the settings page to save it. It only affects relative mode; absolute mode sends coordinates, so there's no such thing as a "multiplier" there.

Saved values are clamped to 0.1–10. Zero, negative numbers and invalid text fall back to 1 — this value is multiplied directly into mouse movement, so a bad value isn't a cosmetic problem; it makes the mouse move backwards or not at all.

The multiplier produces fractions, and the fractional parts accumulate across frames and are sent later, so at `×1.5` ten consecutive moves of 1 deliver exactly 15 units instead of being rounded down frame by frame to 10. Anything beyond ±127 after scaling is sent by the splitting mechanism above and isn't truncated again — **which is why the multiplier has to be built on top of splitting**: before that, scaling up would only push more movement into truncation, and the bigger the multiplier, the more would be lost.

### Mouse modes and pointer lock

The default is **absolute mode**: the position of your local cursor in the picture maps directly to coordinates on the target PC, so the two cursors correspond one to one, which is the most intuitive. A few BIOSes and older systems don't recognize absolute-coordinate USB mice; in that case switch to **relative mode** on the settings page, which only reports movement.

**Android requires relative mode**: it only shows a pointer for relative mice; an absolute mouse is treated as a touch-type device and no pointer appears on screen at all, as if the mouse weren't recognized. macOS works with both modes (provided the chip is in mode 2; see the next section). So **mode 2 + relative mode** is the combination that works for both macOS and Android, without changing the configuration every time you switch targets.

Relative mode has an inherent pitfall: movement is calculated from changes in your local cursor position, and once the cursor hits the edge of the screen it stops moving, so the target PC's cursor gets stuck there too. That's why, in relative mode, **clicking the picture automatically locks the pointer** — your local cursor is hidden and freed from the screen edges, so you can push as far as you like. Press **Esc** to release it.

Locking also turns off local pointer acceleration (`unadjustedMovement`), because the target PC adds its own, and the two layers stacked make the mouse hard to control. If the platform doesn't support it, it falls back to regular locking automatically. Hover over the keyboard/mouse status icon to see whether it says "Pointer locked" or "Click the picture to lock the pointer".

Absolute mode doesn't need and won't use pointer lock; it needs the real cursor coordinates.

### Chip working mode (must-read for macOS)

The CH9329 ships in **mode 0**: a three-function composite device of keyboard + mouse + custom HID. Everything works fine on Windows, but **macOS doesn't handle this composite device well**, and the symptoms are confusing:

- In relative mode, clicks do nothing at all, as if it weren't connected;
- In absolute mode, you can move and click, **but you can't drag**, no matter how slowly.

The cause is that macOS doesn't bind the relative mouse collection in the composite device and only recognizes the absolute mouse, and its drag support for absolute pointing devices is poor. WCH's datasheet explicitly recommends **mode 2** (keyboard + mouse, without custom HID) for Linux / Android / macOS.

On the settings page, select "2: Keyboard + mouse (recommended for Linux / Android / macOS)" and click "Write working mode". **Again, you must power-cycle the CH9329 (unplug and replug it) for it to take effect.** Afterwards the target PC sees it as a new keyboard, and macOS may pop up the Keyboard Setup Assistant — you can either go through it (pressing `Z` and then `/` as prompted means US layout) or just close it.

Mode 2 includes both keyboard and mouse — the 2019 protocol document saying "mode 2 is mouse only" is out of date; in testing, both keyboard and mouse are present.

Mode 2 has been tested on Windows, macOS and Android target PCs, and works on all of them. Mode 0 only works properly on Windows, so **there's no reason to stay in mode 0**.

If the configuration ever gets messed up, "Restore factory settings" on the settings page restores all parameters and string descriptors (baud rate back to 9600, working mode back to 0). If you can't even talk to it over serial anymore, the chip has a hardware fallback: **pulling the SET pin low forces it back into protocol transfer mode, whatever mode it's in**.

### Baud rate

The CH9329 defaults to 9600bps, which can feel a little sluggish when moving the mouse quickly at 1080p. You can change it on the settings page: choose a baud rate and click "Write baud rate". **After writing, you must power-cycle the CH9329 (unplug and replug it) for it to take effect** (the protocol applies parameters at the next power-on).

When connecting, the control page automatically detects the baud rate the chip is actually using, so it connects even if the setting doesn't match the chip; each wrong guess just costs about a second for that connection (the last successful rate is tried first, so normally it hits on the first try).

The available options are `Ch9329.BAUD_RATES`; the dropdown is generated from it, and `setBaudRate()` only accepts values from it. This isn't an unnecessary restriction: **if you write a baud rate that can't be detected, you'll never be able to connect to the chip again** — "Restore factory settings" itself requires communicating with the chip, so there's no software way back and your only option is the SET pin.

Before adding more options, make sure both ends can keep up:

- **The CH9329 (without the F suffix) only supports up to 115200**; writing a higher value will lose contact with it. The CH9329F is rated up to 15Mbps.
- The USB-to-serial chip is also a bottleneck: the CH340 goes up to 2Mbps and the CH343 up to 6Mbps. The CH343 is full-speed USB, and its datasheet recommends **avoiding continuous communication at 3Mbps and above**, so the default list tops out at 2M.

In practice, KVM packets are only a dozen or so bytes; at 115200 a packet takes about 1ms, and going higher brings little benefit — the bottleneck shifts to USB round-trip latency and waiting for replies.

### "Can't open serial port"

Serial ports are exclusive: one CH9329 can only be opened by one page at a time. The most common cause is **another tab still being open** — for example the settings page you just used to write the baud rate, or a control page you forgot to close last time. Close the extra tabs, keep just one control page, and reload.

If it still won't open after closing everything, unplug the CH9329 and plug it back in. The "Details" at the end of the message list the result for each baud rate tried: "can't open serial port" means the port itself is unusable, while "opened, but the chip didn't respond" points to a wiring or chip problem.

### Development

The project is a purely static site with no build step; serve it with any static server (Web Serial requires HTTPS or localhost).

The keyboard/mouse protocol has a test suite with no external dependencies; the expected bytes are taken directly from the command examples in the CH9329 Serial Communication Protocol V1.3:

```bash
npm test
```
