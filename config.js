// 🎃 Fill these in (see README.md). Leave SUPABASE_URL empty to run in local demo mode.
export default {
  PARTY_NAME: "Spooky Birthday Bash",
  PARTY_SUB: "Saturday · Nov 7 · Summon your songs before the night falls 🦇",

  SUPABASE_URL: "https://esrwlpgwzfaaypoklmhl.supabase.co",          // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "sb_publishable_TZ0qVYRlSh5YJt_Ztny17w_-m1aaUGq",     // Supabase → Project Settings → API → anon public key

  SPOTIFY_CLIENT_ID: "9145fd406a204a3896a2ea37a2f45ffc",     // developer.spotify.com app (only used on the DJ page)
  GETSONGBPM_API_KEY: "",    // optional, getsongbpm.com/api — auto-fills BPM/key

  AUTO_LIMIT: 5,             // songs that go straight onto the list
  TOTAL_LIMIT: 8,            // after AUTO_LIMIT, the rest are wildcards needing DJ approval
};
