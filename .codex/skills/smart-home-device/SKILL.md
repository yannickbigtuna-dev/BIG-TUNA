---
name: smart-home-device
description: Design and implement safe BIG-TUNA smart-home device integrations with explicit state, authentication, retry, timeout, firmware-compatibility, and fail-safe behavior. Use for ESP8266 or ESP32 firmware, relays, sensors, device APIs, device-state synchronization, or troubleshooting connected-device behavior.
---

# Smart Home Device Skill

Use for ESP8266/ESP32, relays, sensors, and device APIs.

Define before coding:
- Device identity and authentication
- Desired-state and reported-state fields
- Polling or event interval
- Retry limit and exponential backoff
- Offline timeout
- Safe boot and disconnect state
- Firmware/API version compatibility

Implementation rules:
- Commands must be idempotent.
- Do not rapidly cycle relays after reconnect.
- Use bounded network timeouts and watchdog-friendly loops.
- Keep secrets out of source control.
- Preserve existing device endpoints unless a migration is included.
- Expose enough status to distinguish server, Wi-Fi, device, and physical-output failures.
