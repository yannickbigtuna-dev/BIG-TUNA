# Move BIG TUNA hosting and development to the Mac mini

This kit prepares an Apple Silicon Mac with 16 GB RAM and 256 GB storage on Ethernet. It preserves the existing website domain, accounts, application state, encryption keys, native app identities, complete Git repositories and unfinished work. The Windows server remains live until you deliberately run the final export. It is a local unsigned executable script kit, not a notarized .app or Windows .exe.

## 1. Download the prepared kit on the Mac

On Windows, open `C:\BigTuna-Migration` and double-click `Start-Download.cmd`. Accept the administrator prompt using this same Windows account. It shows a private home-network URL. Keep the window open.

On the Mac, open that exact URL in Safari. Download `BigTuna-Mac-Migration.zip`, then double-click the zip. The extracted folder is `BigTuna-Mac-Kit`; keep its entire contents together. The kit includes the encrypted preliminary `migration.btm`. Recovery keys are not included or served by the download tool.

Open `C:\BigTuna-Migration\Preview\RECOVERY-KEY.txt` on Windows. Keep the key in your password manager or another private channel so you can paste it on the Mac. Compare the downloaded zip's SHA-256 using `shasum -a 256 ~/Downloads/BigTuna-Mac-Migration.zip` with `C:\BigTuna-Migration\BigTuna-Mac-Migration.zip.sha256` before running the unsigned kit. Do not share the entire Preview directory; a failed/crashed export can leave private intermediate files there. A USB drive is an alternative: copy only the kit zip, with its key stored separately.

The download tool accepts only the kit zip and completed final encrypted bundle, requires a random URL, and opens a temporary firewall rule restricted to the local subnet on a Private network. If Windows calls your trusted home Wi-Fi Public, change that connection to Private in Settings and rerun. Close the download window with Ctrl+C when done. No domain or router port-forward changes are needed.

## 2. Install and check the Mac preview

1. Open `BigTuna-Mac-Kit/Setup.command` in Finder. If permissions were lost during unzip, open Terminal and run `chmod +x "$HOME/Downloads/BigTuna-Mac-Kit/"*.command`, then open it again. If macOS blocks this unsigned local script, approve this specific script in System Settings → Privacy & Security → Open Anyway. Do not turn off Gatekeeper globally.
2. Finish Apple's Command Line Tools installation if prompted, then rerun Setup. Approve the Homebrew administrator prompt. Setup installs Node 24, Git, GitHub CLI, Cloudflare Tunnel, Google Chrome and an isolated PM2 runtime. It does not download Xcode or all local AI weights.
3. In the file chooser select the `migration.btm` in the kit folder. Paste the separate Preview recovery key when prompted; input is hidden.
4. Identify Ethernet's interface using `networksetup -listallhardwareports` in Terminal. Enter its Device value, usually `en0`, when asked. Keep Ethernet on the same trusted home LAN as your lights/HomeKit devices.
5. Run `Verify.command`. It checks the correct server processes, authenticated MCP and a native Chrome browser launch. On `http://127.0.0.1:3000`, sign in and check your saved records and essential apps. Preview does not start the public tunnel, HomeKit or scheduled email/Strava/push jobs. Manual app actions can still call external APIs, so don't send email or control devices as a preview test.

Each restore creates a fresh directory below `~/BigTuna/generations`. `~/BigTuna/control/current` records the current generation. Failed restores preserve earlier generations. Each generation contains `SERVER`, `APPS` and `PRIVATE`; the latter holds original credentials/developer configuration, not public web content. Important application environment variables and saved PM2 credentials outside server.env are included privately too; server.env takes priority during restore. Do not do new app development in preview before the final restore unless you separately save that work.

Windows browser profiles are preserved, but Chrome sessions may need reauthentication on macOS. Keep 40–60 GB free for Xcode/simulators/builds in addition to the restore estimate shown by the kit. Windows binaries, dependencies, browser caches, logs and large model weights are rebuildable exclusions; the encrypted manifest lists them. Firmware source, screenshots, app archives, server backups and Git metadata are retained.

## 3. Set up development accounts

Install full Xcode from the Mac App Store, open it, accept its license and install the required iOS/watchOS simulator components. In Xcode Settings → Accounts sign into the same Apple Developer account. Open PocketShift, YannickChallengeIOS and YannickLightsIOS from the current generation's APPS folder, preserve their bundle IDs/App Groups, and choose the existing team for every target. Run simulator tests and build/sign on the actual Mac; copied source does not prove signing or device installation.

GitHub CLI is installed by Setup. In Mac Terminal run:

```sh
/opt/homebrew/bin/gh auth login --hostname github.com --git-protocol https --web
/opt/homebrew/bin/gh auth setup-git
```

Complete the browser sign-in. Set your Git author name/email on the Mac using the values in the privately preserved `PRIVATE/developer/gitconfig`; don't blindly copy Windows credential-helper settings. These commands follow [GitHub's login](https://cli.github.com/manual/gh_auth_login) and [Git credential setup](https://cli.github.com/manual/gh_auth_setup-git) documentation.

Install the Mac desktop app from [OpenAI's official setup guide](https://developers.openai.com/codex/quickstart), sign into your account, and add the current generation's SERVER/APPS folders as projects. Original Codex configuration, custom skills/rules and automation files are preserved under PRIVATE/developer/codex for selective inspection. Windows absolute paths and scheduled jobs require adjustment before reuse. Closed-app conversation/SQLite history is included only in the final export as recovery files; automatic cross-platform chat restoration is not guaranteed. No Windows app database is installed over your Mac app.

The Mac menu-bar app source is preserved under SERVER/desktop. You can install its dependencies and run its existing `package:mac` scripts on the Mac when wanted. Windows USB drivers are excluded/redundant; reconnect firmware hardware and verify the Mac serial device/driver before use.

## 4. Take the final snapshot and switch hosting

Do this only after preview and development checks pass. Your public site will be briefly unavailable while you export, transfer and restore the final data.

1. Save and close Windows editors, device tools, Codex and other programs writing SERVER/APPS or Codex history. On the Mac close editors and avoid writing to preview.
2. On Windows double-click `C:\BigTuna-Migration\Export-Final.cmd`. Use the same Windows user for the administrator prompt and type `EXPORT FINAL` when asked. It disables the two known startup tasks, quarantines the Cloudflare Startup shortcut, stops server updater process trees and the scoped tunnel, stops/saves PM2, verifies ports 3000/3001 are closed, then performs a strict final export. It preserves your files. It does not activate the Mac.
3. Wait for successful completion. The window reports `C:\BigTuna-Migration\Final-YYYYMMDD-HHMMSS`. This folder contains `migration.btm` and its NEW `RECOVERY-KEY.txt`.
4. Run `Start-Download.cmd` again if needed. On the Mac use the URL it displays with the final filename changed to `final-migration.btm`. The download service selects only the newest completed final export. Alternatively transfer the final encrypted file using USB. Transfer its new key separately.
5. On the Mac open `Restore.command`, select the downloaded final bundle and enter its new key. Re-enter the Ethernet interface when prompted. This creates another fresh generation and installs native dependencies there; preview work is not silently merged.
6. Run `Verify.command` again. If Eco AI is essential, run `Setup-Local-AI.command` and type `MODELS` to download your existing `llama3.1:8b` and `qwen2.5-coder:7b` models. It checks free space and manages Ollama through the same isolated PM2 runtime. Use one loaded model at a time on 16 GB RAM.
7. If you use `ssh.yannickmorgans.ca`, enable macOS System Settings → General → Sharing → Remote Login, restrict access to your account, and review/append the saved PRIVATE/ssh/authorized_keys to your Mac authorized_keys with `.ssh` mode 700 and file mode 600. Preserve existing Mac keys. Then run `Enable-SSH.command` and type `SSH`; it verifies localhost port 22 before restoring your original tunnel SSH route. macOS Remote Login owns its SSH boot service. Do not assume the Mac host key matches the old Windows host key.
8. Keep Windows stopped. Run `Activate.command` and type `ACTIVATE`. Activation refuses preliminary snapshots. It saves the production process list and registers `/Library/LaunchDaemons/com.bigtuna.<uid>.plist` running under your Mac account, with explicit Node/PM2 paths and America/Halifax timezone. The website, MCP, tunnel, and configured Ollama start automatically after reboot and recover after crashes. HomeKit and schedulers start inside the main server. No terminal window needs to stay open.

The same Cloudflare tunnel credentials/hostnames are reused. There is no planned domain change. Do not run Windows and Mac production connectors with separate live data at the same time.

## 5. Prove reboot recovery and backups before retiring Windows

1. Run Verify after activation. Check the public website, your account/data, native apps, lights/lamp, HomeKit, remote MCP/SSH where used, Eco AI and a real scheduled workflow at the next normal run. Check physical devices; a browser or test-suite pass cannot prove LAN hardware or Apple delivery.
2. Configure System Settings → Energy to prevent sleep while the display is off and to recover/start after power is restored (the option name depends on macOS/model). See [Apple's desktop energy settings](https://support.apple.com/en-gb/guide/mac-help/mchlp1168/mac). The kit does not alter FileVault. A locked FileVault startup volume can require owner unlock before services become available; test your actual restart/unlock behavior.
3. Restart the Mac. After any required unlock, the domain should work without opening Terminal or running Activate again. Open `Reboot-Check.command` to confirm the launchd job, complete saved production process list and live services recovered. Also check from a phone away from the Mac.
4. Run `Backup.command`, type `BACKUP`, and let it stop writers/create a validated encrypted backup. Backups are under `~/BigTuna-Backups`; keep their `.key` files separately and copy encrypted `.btm` files to an external disk. Run Activate again to resume. To test recovery, Stop production then use `Restore-Backup.command` to restore a fresh preview generation with the backup key, Verify, and Activate after checks. Backups must survive loss of this Mac; a second folder on its SSD is not enough.
5. Leave the Windows files intact until these checks pass. Afterward you can keep Windows powered off and work exclusively on the Mac. Unrelated personal files outside the audited SERVER/APPS/developer roots need their own copy before wiping Windows.

## Recovery and maintenance

Before Mac activation, a failed final export/restore can be recovered by running Windows `Resume-Windows.cmd` and typing `MAC IS STOPPED`. It restores the saved startup settings and checks local services/tunnel before archiving the recovery marker. Never run it while Mac production is active. After Mac-side production writes, first stop Mac writers and preserve/reconcile its newest data; blindly returning to the old Windows snapshot loses those writes.

`Stop.command` stops the Mac services and removes its exact boot registration, so a later reboot cannot unexpectedly reconnect Mac production after a Windows rollback. Activate reinstalls it. `Update.command` is an explicit manual updater: it refuses dirty/non-main checkouts, only fast-forwards and leaves services stopped while installing dependencies. Automatic Git pulling is not installed; review local changes before pulling because these are also development repositories. Mac registry translations may make a restored checkout dirty. Git commits/pushes remain your deliberate development/release actions.

The setup tools were checked on Windows with Node synthetic tests and shell/PowerShell syntax checks. Actual macOS installation, launchd, signing, browser compatibility, device behavior and reboot recovery require executing this procedure on your Mac. The initial encrypted payload is preliminary because the Windows server was left running.
