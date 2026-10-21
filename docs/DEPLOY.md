# Putting Trivvoly online (Hetzner + trivvoly.com)

Step by step, from nothing to https://trivvoly.com. It takes about an hour, most of it waiting.

You'll do everything from **PowerShell** on your PC: press the Windows key, type `PowerShell`, press Enter. Lines in grey boxes are typed or pasted into it (right-click pastes).

What you'll end up with: one small server running Trivvoly, its database and nightly backups, behind HTTPS that renews itself. The server installs security updates by itself.

---

## Part 1: An SSH key (5 minutes)

An SSH key is how your PC proves who it is to the server. It replaces a password, and it can't be guessed.

1. Check whether you already have one:

   ```
   Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   `True` means you have one: skip to step 3.

2. Make one:

   ```
   ssh-keygen -t ed25519 -C "trivvoly"
   ```

   Press Enter to accept the file location. Then type a passphrase you'll remember, twice. It protects the key if your PC is ever stolen. Nothing shows while you type; that's normal.

3. Show the public half, and copy the whole line it prints (it starts with `ssh-ed25519`):

   ```
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   This half is safe to share. The other file, `id_ed25519` without `.pub`, is the secret: never send it anywhere.

## Part 2: The server (10 minutes)

1. Sign up at **https://console.hetzner.cloud**. Hetzner may ask to verify your identity before your first server.
2. Create a project called **Trivvoly** and open it.
3. Click **Add Server** (or **Create Server**) and choose:
   - **Location:** the one closest to where you'll play (e.g. Falkenstein, Nuremberg or Helsinki in Europe; Ashburn or Hillsboro in the US).
   - **Image:** Ubuntu 24.04.
   - **Type:** shared vCPU, x86, the cheapest one with **at least 2 vCPU and 4 GB of RAM**. Check the monthly price shown; it's usually a few euros.
   - **Networking:** keep both **Public IPv4** and **Public IPv6** on.
   - **SSH keys:** **Add SSH key**, paste the line from Part 1, name it after your PC.
   - **Firewalls, volumes, placement groups, cloud config:** leave empty. The setup script turns on a firewall on the server itself.
   - **Backups:** tick it (about 20% on top of the price). Hetzner then keeps daily copies of the whole server somewhere else. Trivvoly also backs up its own database every night, but on the same disk.
   - **Name:** `trivvoly`.
4. Click **Create & Buy now**. After about a minute, the server shows its **IPv4** address (like `65.108.12.34`) and its **IPv6** address (like `2a01:4f9:c012:abcd::/64`). Keep the page open.

## Part 3: Point trivvoly.com at the server (5 minutes, then a wait)

Go to the website where you bought **trivvoly.com**, open its **DNS** settings (sometimes called "DNS records", "Manage DNS" or "Zone editor") and set:

| Type | Name / Host | Value / Points to |
| --- | --- | --- |
| `A` | `@` (or empty, or `trivvoly.com`) | the server's IPv4 address |
| `AAAA` | `@` | the server's IPv6 address with `1` added after the `::`, e.g. `2a01:4f9:c012:abcd::1` |
| `CNAME` | `www` | `trivvoly.com` |

Delete any other `A`, `AAAA` or `CNAME` records for `@` or `www`; registrars often add "parking page" records. Keep everything else, especially `MX` and `TXT` records.

Changes usually show up within minutes, but can take a few hours. To check, run this in PowerShell; it's ready when it prints your server's address:

```
Resolve-DnsName trivvoly.com -Type A
```

## Part 4: Set up the server and start Trivvoly (15 minutes)

1. Connect to the server, replacing the address with your server's IPv4:

   ```
   ssh root@65.108.12.34
   ```

   The first time, it asks whether you trust the server: type `yes`. Then enter your key's passphrase. You're in when the prompt ends in `root@trivvoly:~#`. Everything from here runs on the server.

2. Run the setup script, with **your** email address at the end. It becomes the admin account, gets Let's Encrypt's notices about the HTTPS certificate, and appears on the privacy page as the contact for data questions.

   ```
   curl -fsSL https://raw.githubusercontent.com/yahia-wk/trivvoly/main/deploy/setup-server.sh | bash -s -- trivvoly.com you@example.com
   ```

   It takes a few minutes. It updates the system, installs Docker, turns on the firewall and automatic security updates, makes SSH keys-only, downloads Trivvoly to `/srv/trivvoly`, and writes the settings file `/srv/trivvoly/.env` with a random database password.

3. Make sure Part 3's check prints your server's address, then start Trivvoly:

   ```
   /srv/trivvoly/deploy/deploy.sh
   ```

   The first run builds everything (5 to 10 minutes) and ends with `Trivvoly is running: https://trivvoly.com`.

4. Open **https://trivvoly.com**. It should load with a padlock. The first visit can take a few seconds while the certificate is fetched.

   You can already start games and play. Signing in isn't available yet: Part 5 turns it on.

   If the site doesn't load, DNS probably wasn't ready when Trivvoly started. Wait until Part 3's check works, then run `deploy.sh` again.

## Part 5: Turn on sign-in (20 minutes)

### Email links (Resend)

1. Sign up at **https://resend.com**.
2. **Domains → Add Domain:** type `trivvoly.com`, and pick the region closest to your server.
3. Resend shows a few DNS records (`MX` and `TXT` records on names like `send` and `resend._domainkey`). Add each one, exactly as shown, at your registrar, like Part 3. Then click **Verify DNS Records** in Resend. It can take a little while to turn green.
4. **API Keys → Create API Key:** permission **Sending access**, domain **trivvoly.com**. Copy the key: it's shown only once.

### Google

1. Go to **https://console.cloud.google.com** and create a project called **Trivvoly**.
2. Open **Google Auth Platform**. If you're asked to get started: app name **Trivvoly**, your email as the support and contact email, audience **External**.
3. **Clients → Create client → Web application**. Under **Authorized redirect URIs**, add exactly:

   ```
   https://trivvoly.com/api/auth/google/callback
   ```

   Create it, and copy the **Client ID** and **Client secret**.
4. **Audience → Publish app.** Until you do, only test users you list can sign in.

### Put the keys on the server

1. Open the settings file (on the server, over SSH as before):

   ```
   nano /srv/trivvoly/.env
   ```

2. Fill in these lines. Use the arrow keys to move; delete with Backspace:

   ```
   GOOGLE_CLIENT_ID=...the client ID...
   GOOGLE_CLIENT_SECRET=...the client secret...
   MAIL_FROM=Trivvoly <signin@trivvoly.com>
   RESEND_API_KEY=...the Resend key...
   ```

3. Save and close: **Ctrl+O**, **Enter**, **Ctrl+X**. Then restart with the new settings:

   ```
   /srv/trivvoly/deploy/deploy.sh
   ```

## Part 6: Check everything works

- [ ] https://trivvoly.com loads with a padlock; http://trivvoly.com and https://www.trivvoly.com both end up there.
- [ ] **Sign in → Email me a sign-in link** with your address. The email arrives (check spam the first time), and the link signs you in.
- [ ] Your account page shows **Admin**. The admin overview says Google is **on** and email links are **sent by resend**.
- [ ] Sign out, then **Continue with Google** works.
- [ ] Start a game on a laptop. Join from a phone **on mobile data, not Wi-Fi**. Answer a question, mark it, raise a dispute.
- [ ] **Admin → Live games** shows that game.
- [ ] On the server, `ls /srv/trivvoly/backups` lists a backup (the first is made at startup).

Then tell your friends. 🎉

---

## Looking after it

Connect with `ssh root@<your server's IPv4>`, then:

| To | Run |
| --- | --- |
| Update to the latest version (between games) | `/srv/trivvoly/deploy/deploy.sh` |
| Watch the live logs (Ctrl+C stops watching) | `cd /srv/trivvoly && docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f app` |
| See what's running | `cd /srv/trivvoly && docker compose -f docker-compose.yml -f docker-compose.prod.yml ps` |
| Change settings | `nano /srv/trivvoly/.env`, then `deploy.sh` |
| List backups | `ls -lh /srv/trivvoly/backups` |

Most day-to-day things don't need the server at all; use the **admin page**:
- pause new games or sign-ups
- show a notice ("Back in 5 minutes")
- end a game, remove a team, ban an account

**Copy a backup to your PC.** Run this in PowerShell on your PC, not on the server:

```
scp root@65.108.12.34:/srv/trivvoly/backups/trivvoly-2026-10-22-0300.sql.gz .
```

**Restore a backup.** This replaces everything in the database with the backup. On the server:

```
cd /srv/trivvoly
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$C stop app backup
$C exec -T db dropdb -U trivvoly trivvoly
$C exec -T db createdb -U trivvoly trivvoly
gunzip -c backups/trivvoly-2026-10-22-0300.sql.gz | $C exec -T db psql -q -U trivvoly trivvoly
$C start app backup
```

**If something's wrong:**
- **The admin page:** the overview lists recent problems, each with a request ID.
- **The logs:** search them for that request ID: `... logs app | grep <id>`.
- **Restart:** `$C restart app`.

The server restarts itself at 05:00 when a security update needs it. Running games survive restarts.
