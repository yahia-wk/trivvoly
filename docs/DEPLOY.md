# Putting Trivvoly online (Hetzner + trivvoly.com)

Step by step, from nothing to a live site that updates itself through GitHub. It takes about an
hour and a half, much of it waiting.

**What you'll end up with**

- **trivvoly.com:** the live site.
- **staging.trivvoly.com:** the next version, behind a password, for you to try first.
- **Every change goes through GitHub:** change → pull request → automatic checks → merge →
  staging → you click **Approve** → live. Nothing reaches the live site without you.
- **Daily security checks:** your code (CodeQL), every package Trivvoly uses, and the server
  image. You get an email if something's found. Dependabot opens pull requests for updates.
- **The server:** a firewall, automatic security updates, HTTPS that renews itself, and nightly
  database backups for each site.

**Where you'll work**

- **PowerShell on your PC:** press the Windows key, type `PowerShell`, press Enter.
- **Web pages:** GitHub, Hetzner, your domain registrar, Resend and Google.

Lines in grey boxes are typed or pasted (right-click pastes in PowerShell).

---

## Part 1: An SSH key (5 minutes)

An SSH key is how your PC proves who it is to the server. It replaces a password, and it can't be
guessed.

1. Check whether you already have one:

   ```
   Test-Path $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   `True` means you have one: skip to step 3.

2. Make one:

   ```
   ssh-keygen -t ed25519 -C "trivvoly"
   ```

   Press Enter to accept the file location. Then type a passphrase you'll remember, twice
   (nothing shows while you type; that's normal). It protects the key if your PC is ever stolen.

3. Show the public half, and copy the whole line it prints (it starts with `ssh-ed25519`):

   ```
   Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   This half is safe to share. The other file, `id_ed25519` without `.pub`, is the secret: never
   send it anywhere.

## Part 2: The server (10 minutes)

1. Sign up at **https://console.hetzner.cloud**. Hetzner may ask to verify your identity first.
2. Create a project called **Trivvoly** and open it.
3. Click **Add Server** (or **Create Server**) and choose:
   - **Location:** the one closest to your players (e.g. Falkenstein, Nuremberg or Helsinki in
     Europe; Ashburn or Hillsboro in the US).
   - **Image:** Ubuntu 24.04.
   - **Type:** shared vCPU, **x86** (not Arm), the cheapest with **at least 2 vCPU and 4 GB RAM**.
     Check the monthly price shown.
   - **Networking:** keep **Public IPv4** and **Public IPv6** on.
   - **SSH keys:** **Add SSH key**, paste the line from Part 1, name it after your PC.
   - **Backups:** tick it (about 20% extra). Hetzner then keeps daily copies of the whole server
     somewhere else.
   - Leave everything else as it is. **Name:** `trivvoly`.
4. Click **Create & Buy now**. After a minute the server shows its **IPv4** address (like
   `65.108.12.34`) and **IPv6** address (like `2a01:4f9:c012:abcd::/64`). Keep the page open.

## Part 3: Point trivvoly.com at the server (5 minutes, then a wait)

At the website where you bought **trivvoly.com**, open its **DNS** settings ("DNS records",
"Manage DNS" or "Zone editor") and add:

| Type | Name / Host | Value / Points to |
| --- | --- | --- |
| `A` | `@` (or empty) | the server's IPv4 address |
| `AAAA` | `@` | the IPv6 address with `1` after the `::`, e.g. `2a01:4f9:c012:abcd::1` |
| `CNAME` | `www` | `trivvoly.com` |
| `A` | `staging` | the server's IPv4 address |
| `AAAA` | `staging` | the same IPv6 address as above |

Delete any other `A`, `AAAA` or `CNAME` records for `@`, `www` or `staging`; registrars often add
parking-page records. Leave everything else alone (especially `MX` and `TXT` records).

To check, run this in PowerShell; it's ready when both print your server's address (minutes,
occasionally a few hours):

```
Resolve-DnsName trivvoly.com -Type A
Resolve-DnsName staging.trivvoly.com -Type A
```

## Part 4: GitHub settings (15 minutes)

All on **https://github.com/yahia-wk/trivvoly → Settings**.

1. **Security:** **Advanced Security** (sometimes **Code security**) in the left menu. Turn on:
   - **Private vulnerability reporting**
   - **Dependency graph**, **Dependabot alerts** and **Dependabot security updates**
   - **Secret Protection** (secret scanning) and **Push protection**: GitHub then blocks any push
     that contains a password or API key.
   - Code scanning is already set up by the CodeQL workflow. If the page offers "default setup",
     leave it off.
2. **Actions → General:**
   - **Workflow permissions:** **Read repository contents and packages permissions**.
   - Leave "Allow GitHub Actions to create and approve pull requests" unticked.
   - Save.
3. **Environments → New environment**, twice:
   - **`staging`:**
     - **Deployment branches and tags** → **Selected branches and tags** → add `main`.
     - Save.
   - **`production`:**
     - Tick **Required reviewers**, add **yourself**, and leave **Prevent self-review** unticked
       (you're the only reviewer).
     - **Deployment branches and tags** → **Selected branches and tags** → add `main`.
     - Save.
4. **Rules → Rulesets → New ruleset → New branch ruleset:**
   - **Name:** `main`. **Enforcement status:** Active.
   - **Target branches:** Add target → **Include default branch**.
   - Tick:
     - **Restrict deletions**
     - **Block force pushes**
     - **Require a pull request before merging** (required approvals: **0**, since you're the only
       person working on it)
     - **Require status checks to pass**: add the checks **Backend tests (Postgres)**, **Frontend
       type-check, tests and build** and **Docker image builds**. GitHub suggests them once
       they've run.
   - Create.
5. **Packages:**
   - Open https://github.com/yahia-wk?tab=packages → **trivvoly** → **Package settings**.
   - Under **Danger Zone**, check the visibility is **Public**, so the server can download the
     image without a password. If it says Private, **Change visibility → Public**.

## Part 5: Set up the server (15 minutes)

1. Connect from PowerShell (your server's IPv4 address):

   ```
   ssh root@65.108.12.34
   ```

   The first time, it asks whether to trust the server: type `yes`, then your key's passphrase.
   You're in when the prompt ends with `root@trivvoly:~#`. The next steps run on the server.

2. Run the setup, with **your** email address at the end. It becomes the admin, the privacy
   contact, and gets Let's Encrypt's notices about the HTTPS certificates.

   ```
   curl -fsSL https://raw.githubusercontent.com/yahia-wk/trivvoly/main/deploy/setup-server.sh | bash -s -- trivvoly.com you@example.com
   ```

   It takes a few minutes. It:
   - updates the system, installs Docker, and turns on the firewall and automatic security updates
   - makes SSH keys-only
   - downloads Trivvoly to `/srv/trivvoly`
   - writes the settings, with random database passwords
   - makes the staging password and the two deploy keys GitHub will use

3. At the end it prints:
   - three **variables**
   - two **deploy keys**: each a block from `-----BEGIN OPENSSH PRIVATE KEY-----` to
     `-----END OPENSSH PRIVATE KEY-----`
   - the **staging login**

   **Leave the window open**: these are shown only once. Do Part 6 now. Then save the staging
   login in your password manager, and type `clear` on the server.

## Part 6: Connect GitHub to the server (10 minutes)

On **https://github.com/yahia-wk/trivvoly → Settings**:

1. **Secrets and variables → Actions → Variables → New repository variable**, once for each:

   | Name | Value |
   | --- | --- |
   | `DOMAIN` | `trivvoly.com` |
   | `DEPLOY_HOST` | the address setup printed |
   | `DEPLOY_KNOWN_HOSTS` | the whole line setup printed (address, `ssh-ed25519`, then the key) |

2. **Environments → staging → Environment secrets → Add environment secret:**
   - **Name:** `DEPLOY_SSH_KEY`.
   - **Value:** the **staging** key block, every line from BEGIN to END.
3. **Environments → production → Add environment secret:**
   - **Name:** `DEPLOY_SSH_KEY`.
   - **Value:** the **production** key block.
4. Last, **Variables → New repository variable:**
   - **Name:** `DEPLOY_ENABLED`.
   - **Value:** `true`.

   From now on, every merge to main deploys.

## Part 7: The first deploy (10 minutes)

1. Go to **Actions → Deploy → Run workflow**:
   - **environment:** `staging`.
   - **sha:** the full ID of the latest commit. Find it on the repository's front page (click the
     short ID next to the latest commit, then copy the long one from the address bar).
   - Click **Run workflow**.
2. When it's green, open **https://staging.trivvoly.com**. The browser asks for the staging login
   from Part 5. Start a game and play a question.
3. Run **Deploy** again with environment **`production`** and the same ID. It waits for you: open
   the run and click **Review deployments → Approve and deploy**.
4. Open **https://trivvoly.com**. 🎉

After this, you won't run Deploy by hand any more: merging to main does staging by itself, then
waits for your approval for production.

## Part 8: Turn on sign-in (20 minutes)

### Email links (Resend)

1. Sign up at **https://resend.com**.
2. **Domains → Add Domain:** `trivvoly.com`, in the region closest to your server.
3. Add each DNS record Resend shows (`MX` and `TXT` records on names like `send` and
   `resend._domainkey`) at your registrar, exactly as shown. Then click **Verify DNS Records**. It
   can take a while to turn green.
4. **API Keys → Create API Key:** permission **Sending access**, domain **trivvoly.com**. Copy it:
   it's shown once.

### Google

1. At **https://console.cloud.google.com**, create a project called **Trivvoly**.
2. Open **Google Auth Platform**. If asked: app name **Trivvoly**, your email as support and
   contact email, audience **External**.
3. **Clients → Create client → Web application.** Under **Authorized redirect URIs**, add both:

   ```
   https://trivvoly.com/api/auth/google/callback
   https://staging.trivvoly.com/api/auth/google/callback
   ```

   Create it, and copy the **Client ID** and **Client secret**.
4. **Audience → Publish app**, or only test users you list can sign in.

### Put the keys on the server

1. Over SSH (Part 5, step 1), open the shared settings:

   ```
   nano /srv/trivvoly/env/common.env
   ```

2. Fill in these lines (arrow keys to move, Backspace to delete):

   ```
   GOOGLE_CLIENT_ID=...the client ID...
   GOOGLE_CLIENT_SECRET=...the client secret...
   MAIL_FROM=Trivvoly <signin@trivvoly.com>
   RESEND_API_KEY=...the Resend key...
   ```

   Save and close: **Ctrl+O**, **Enter**, **Ctrl+X**.

3. Apply the new settings by redeploying both sites with the same version: **Actions → Deploy**,
   first `staging`, then `production`.

## Part 9: Check everything works

- [ ] https://trivvoly.com loads with a padlock; http://trivvoly.com and https://www.trivvoly.com
      both end up there.
- [ ] https://staging.trivvoly.com asks for the staging login.
- [ ] **Sign in → Email me a sign-in link**: the email arrives (check spam the first time) and
      signs you in.
- [ ] Your account page shows **Admin**. The admin overview says Google is **on**, email links
      are **sent by resend**, and shows the version (the start of the commit ID).
- [ ] **Continue with Google** works.
- [ ] Start a game on a laptop, join from a phone **on mobile data, not Wi-Fi**, play a question,
      mark it, dispute it.
- [ ] On the server, `ls /srv/trivvoly/backups/production` lists a backup.
- [ ] **GitHub → Security** shows no open alerts.

Then tell your friends.

---

## Making a change

From your PC (with me), or on github.com:

1. **On github.com:**
   - Open a file, click the pencil, and make the change.
   - Click **Commit changes…** → **Create a new branch for this commit and start a pull
     request** → **Propose changes** → **Create pull request**.
2. **The checks run on the pull request.** **Merge** turns green when they pass.
3. **Merge it.** The release builds the image, scans it, and puts it on **staging.trivvoly.com**.
4. **Try it on staging.**
5. **In Actions,** the release waits at **production**: **Review deployments → Approve and
   deploy**. If something's wrong on staging, don't approve: fix it with another pull request.

Dependabot's update pull requests work the same way: check that the checks pass, merge, try
staging, approve.

**Rolling back:**
1. **Actions → Deploy → Run workflow:** environment `production`, and the full ID of the last good
   commit.
2. Approve it.

The previous images are kept, so this takes a minute.

## Security emails

- **A daily check fails:** GitHub emails you. Open the run to see what's affected; usually the
  fix is a Dependabot pull request or a package update.
- **CodeQL finds something:** it shows under **Security → Code scanning**.
- **Someone reports a vulnerability:** you get a private report under **Security → Advisories**
  (see `SECURITY.md`).

## Looking after the server

Connect with `ssh root@<your server's IPv4>`, then:

| To | Run |
| --- | --- |
| See what's running where | `/srv/trivvoly/deploy/deploy.sh status` |
| Watch the live site's logs (Ctrl+C stops) | `cd /srv/trivvoly && docker compose -p trivvoly-production logs -f app` |
| Change settings | `nano /srv/trivvoly/env/common.env` (both sites) or `env/production.env`, then redeploy |
| List backups | `ls -lh /srv/trivvoly/backups/production` |

**Copy a backup to your PC.** Run this in PowerShell on your PC, not on the server:

```
scp root@65.108.12.34:/srv/trivvoly/backups/production/trivvoly-2026-10-22-0300.sql.gz .
```

**Restore a backup.** This replaces everything in that site's database. On the server:

```
cd /srv/trivvoly
C="docker compose -p trivvoly-production --env-file env/common.env --env-file env/production.env -f docker-compose.yml -f docker-compose.prod.yml"
export TRIVVOLY_TAG=sha-$(git rev-parse HEAD)
$C stop app backup
$C exec -T db dropdb -U trivvoly trivvoly
$C exec -T db createdb -U trivvoly trivvoly
gunzip -c backups/production/trivvoly-2026-10-22-0300.sql.gz | $C exec -T db psql -q -U trivvoly trivvoly
$C start app backup
```

**If something's wrong:**
- **The admin page:** the overview lists recent problems, each with a request ID.
- **The logs:** search them for that ID with `docker compose -p trivvoly-production logs app | grep <id>`.

The server restarts itself at 05:00 when a security update needs it. Running games survive
restarts.

## Changing your SSH key (a new PC)

The server keeps a list of allowed keys in `/root/.ssh/authorized_keys`, one per line. You can
have several (a laptop and a desktop). Leave the two `github-deploy-…` lines alone: they're
GitHub's.

**New PC, old one still works:**
1. On the new PC, make a key and show its public line (Part 1, steps 2 and 3).
2. Get that line to the old PC (email, chat or USB stick are fine: it's the public half).
3. On the old PC:

   ```
   ssh root@65.108.12.34 "echo 'ssh-ed25519 AAAA...the new line... trivvoly' >> ~/.ssh/authorized_keys"
   ```

4. Check the new PC gets in: `ssh root@65.108.12.34`.
5. Optional: remove the old PC's line with `nano ~/.ssh/authorized_keys`.

Copying the key files (`id_ed25519` and `id_ed25519.pub` in `C:\Users\<you>\.ssh\`) to the new PC
also works. `id_ed25519` is the secret half, though: move it on a USB stick only, never by email
or chat.

**Old PC lost or broken:**
1. In the Hetzner console, open the server: **Rescue → Reset root password**.
2. Click **Console** (`>_`) and log in as `root` with that password. Passwords are only switched
   off for SSH, not for this console.
3. Add the new key's line to `~/.ssh/authorized_keys`, and delete the lost PC's line.

**If a GitHub deploy key may have leaked:**
1. On the server, run the setup again with `--new-deploy-keys` at the end:

   ```
   curl -fsSL https://raw.githubusercontent.com/yahia-wk/trivvoly/main/deploy/setup-server.sh | bash -s -- trivvoly.com you@example.com --new-deploy-keys
   ```

2. Put the new keys into GitHub as in Part 6, steps 2 and 3.

The old keys stop working straight away. Your settings, data and passwords are kept.
