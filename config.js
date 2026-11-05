// 🎃 Fill these in (see README.md). Leave SUPABASE_URL empty to run in local demo mode.
export default {
  PARTY_NAME: "Spooky Birthday Bash",
  PARTY_SUB: "Saturday · Nov 7",

  SUPABASE_URL: "https://esrwlpgwzfaaypoklmhl.supabase.co",          // e.g. https://abcd1234.supabase.co
  SUPABASE_ANON_KEY: "sb_publishable_TZ0qVYRlSh5YJt_Ztny17w_-m1aaUGq",     // Supabase → Project Settings → API → anon public key

  SPOTIFY_CLIENT_ID: "9145fd406a204a3896a2ea37a2f45ffc",     // developer.spotify.com app (only used on the DJ page)
  GETSONGBPM_API_KEY: "",    // optional, getsongbpm.com/api — auto-fills BPM/key

  AUTO_LIMIT: 5,             // songs that go straight onto the list
  WILD_BLESS: 3,             // after AUTO_LIMIT, guests send unlimited wildcards; the DJ blesses up to this many each
  TOTAL_LIMIT: 40,           // safety cap per guest
};
