# 🎃 Spooky Birthday Playlist

Guests paste songs from SoundCloud, Spotify, Apple Music, YouTube or YouTube Music. The DJ page orders them into a set.

- **Guest page** (`index.html`): summon songs, upvote 🔥, leaderboard, wildcard queue, graveyard
- **DJ page** (`dj.html?key=YOUR-SECRET`): smart set builder (Camelot key + BPM + energy curve), wildcard approvals, SoundCloud ❤️ queue, Spotify auto-add, CSV export

Rules: each guest gets **5 songs that go straight onto the list**, then **3 wildcards** that need DJ approval. Upvotes are unlimited and don't count toward the limit.

---

## Setup (~15 minutes)

### 1. Database (Supabase, free)
1. Go to https://supabase.com, sign up, and create a **New project** (any name or region; save the DB password somewhere).
2. Open **SQL Editor → New query**, paste all of `supabase.sql`, and **change `change-me-pumpkin` on the last line** to your own secret word. Click **Run**.
3. Open **Project Settings → API** (or **Data API** / **API Keys**) and copy the **Project URL** and the **anon / publishable** key.
4. Paste both into `config.js` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).

### 2. Put it online (GitHub Pages)
```bash
cd ~/spooky-playlist
gh auth login
gh repo create spooky-playlist --public --source=. --push
gh api -X POST repos/{owner}/spooky-playlist/pages -f "source[branch]=main" -f "source[path]=/"
```
After about a minute it's live at `https://YOUR-GITHUB-NAME.github.io/spooky-playlist/`. That's the link to send people.

Your DJ link is `https://YOUR-GITHUB-NAME.github.io/spooky-playlist/dj.html?key=YOUR-SECRET`. **Don't share it.**

### 3. Spotify auto-add (optional)
1. Go to https://developer.spotify.com/dashboard → **Create app**.
2. Set the Redirect URI to `https://YOUR-GITHUB-NAME.github.io/spooky-playlist/dj.html` (exactly). Choose **Web API**.
3. Copy the **Client ID** into `config.js` → `SPOTIFY_CLIENT_ID`, then commit and push.
4. On the DJ page, open **🟢 Spotify → Connect**, pick or create a playlist, and tick **Auto-add**.

### 4. BPM/key auto-fill (optional)
Get a free key at https://getsongbpm.com/api, put it in `GETSONGBPM_API_KEY`, and the **🔍 Auto-fill BPM/key** button appears. Their terms ask for a visible link back to getsongbpm.com.
Bootlegs usually won't be found. Type their BPM and key in yourself (`8A` or `Am` both work), or leave them for Rekordbox to analyze.

### Updating after edits
```bash
git add -A && git commit -m "update" && git push
```

## Try it locally
With `SUPABASE_URL` left empty, it runs in **demo mode**: everything is saved in your browser, and the DJ key is `demo`.
```bash
python3 -m http.server 8765
```
Then open http://localhost:8765 and http://localhost:8765/dj.html?key=demo

## Notes
- Guests are identified by their name plus their browser, so there are no logins. Someone could get around the limits by switching browsers. That's fine for a party.
- The DJ secret key is only checked on the database side, so guests can't veto or approve songs.
- Spotify login stays only in the DJ's browser.
