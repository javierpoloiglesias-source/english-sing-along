/**
 * TOP 100 GLOBAL — selección editorial de English Sing Along.
 *
 * IMPORTANTE: es una selección editorial de grandes éxitos internacionales en
 * inglés, NO un ranking oficial ni en tiempo real.
 *
 * `yt` es un identificador de vídeo CANDIDATO. No se ha podido verificar al
 * crear el catálogo, así que la aplicación lo comprueba en tu ordenador
 * (oEmbed público de YouTube, vía el servidor local) antes de usarlo. Si no
 * existe, no admite inserción o su título no coincide, se usa un enlace de
 * búsqueda de YouTube. Sin `yt` → siempre enlace de búsqueda.
 *
 * Nivel de inglés: 1 = principiante, 2 = intermedio, 3 = avanzado
 * (estimación editorial según velocidad, vocabulario y claridad de la letra).
 * La duración se obtiene del reproductor al cargar el vídeo o el archivo.
 */
const RAW = [
  // title, artist, genre, year, level, yt candidate, album
  ["Hello", "Adele", "Soul", 2015, 1, "YQHsXMglC9A", "25"],
  ["Someone Like You", "Adele", "Soul", 2011, 1, "hLQl3WQQoQ0", "21"],
  ["Rolling in the Deep", "Adele", "Soul", 2010, 2, "rYEDA3JcQqw", "21"],
  ["Blinding Lights", "The Weeknd", "Synth-pop", 2019, 2, "4NRXx6U8ABQ", "After Hours"],
  ["Save Your Tears", "The Weeknd", "Synth-pop", 2020, 2, "XXYlFuWEuKI", "After Hours"],
  ["Starboy", "The Weeknd ft. Daft Punk", "R&B", 2016, 3, "34Na4j8AVgA", "Starboy"],
  ["Shape of You", "Ed Sheeran", "Pop", 2017, 2, "JGwWNGJdvx8", "÷ (Divide)"],
  ["Perfect", "Ed Sheeran", "Balada", 2017, 1, "2Vv-BfVoq4g", "÷ (Divide)"],
  ["Thinking Out Loud", "Ed Sheeran", "Balada", 2014, 1, "lp-EO5I60KA", "x (Multiply)"],
  ["Photograph", "Ed Sheeran", "Balada", 2014, 1, "nSDgHBxUbVQ", "x (Multiply)"],
  ["Shake It Off", "Taylor Swift", "Pop", 2014, 2, "nfWlot6h_JM", "1989"],
  ["Blank Space", "Taylor Swift", "Pop", 2014, 2, "e-ORhEE9VVg", "1989"],
  ["Love Story", "Taylor Swift", "Country pop", 2008, 1, "8xg3vE8Ie_E", "Fearless"],
  ["Anti-Hero", "Taylor Swift", "Pop", 2022, 2, "b1kbLwvqugk", "Midnights"],
  ["Viva la Vida", "Coldplay", "Rock alternativo", 2008, 2, "dvgZkm1xWPE", "Viva la Vida or Death and All His Friends"],
  ["The Scientist", "Coldplay", "Rock alternativo", 2002, 1, "RB-RcX5DS5A", "A Rush of Blood to the Head"],
  ["Yellow", "Coldplay", "Rock alternativo", 2000, 1, "yKNxeF4KMsY", "Parachutes"],
  ["Fix You", "Coldplay", "Rock alternativo", 2005, 1, "k4V3Mo61fJM", "X&Y"],
  ["Believer", "Imagine Dragons", "Pop rock", 2017, 2, "7wtfhZwyrcc", "Evolve"],
  ["Radioactive", "Imagine Dragons", "Pop rock", 2012, 2, "ktvTqknDobU", "Night Visions"],
  ["Demons", "Imagine Dragons", "Pop rock", 2013, 2, "mWRsgZuwf_8", "Night Visions"],
  ["Thunder", "Imagine Dragons", "Pop rock", 2017, 1, "fKopy74weus", "Evolve"],
  ["Bohemian Rhapsody", "Queen", "Rock", 1975, 3, "fJ9rUzIMcZQ", "A Night at the Opera"],
  ["Don't Stop Me Now", "Queen", "Rock", 1979, 3, "HgzGwKwLmgM", "Jazz"],
  ["We Will Rock You", "Queen", "Rock", 1977, 1, "-tJYN-eG1zk", "News of the World"],
  ["Another One Bites the Dust", "Queen", "Rock", 1980, 2, "rY0WxgSXdEE", "The Game"],
  ["Billie Jean", "Michael Jackson", "Pop", 1983, 2, "Zi_XLOBDo_Y", "Thriller"],
  ["Thriller", "Michael Jackson", "Pop", 1982, 3, "sOnqjkJTMaA", "Thriller"],
  ["Beat It", "Michael Jackson", "Pop rock", 1983, 2, "oRdxUFDoQe0", "Thriller"],
  ["Uptown Funk", "Mark Ronson ft. Bruno Mars", "Funk", 2014, 3, "OPf0YbXqDm0", "Uptown Special"],
  ["Just the Way You Are", "Bruno Mars", "Pop", 2010, 1, "LjhCEhWiKXk", "Doo-Wops & Hooligans"],
  ["The Lazy Song", "Bruno Mars", "Pop", 2011, 1, "fLexgOxsZu0", "Doo-Wops & Hooligans"],
  ["When I Was Your Man", "Bruno Mars", "Balada", 2013, 1, "ekzHIouo8Q4", "Unorthodox Jukebox"],
  ["Umbrella", "Rihanna ft. Jay-Z", "R&B", 2007, 2, "CvBfHwUxHIk", "Good Girl Gone Bad"],
  ["Diamonds", "Rihanna", "Pop", 2012, 1, "lWA2pjMjpBs", "Unapologetic"],
  ["Love the Way You Lie", "Eminem ft. Rihanna", "Hip hop", 2010, 3, "uelHwf8o7_U", "Recovery"],
  ["Sorry", "Justin Bieber", "Pop", 2015, 1, "fRh_vgS2dFE", "Purpose"],
  ["Love Yourself", "Justin Bieber", "Pop", 2015, 1, "oyEuk8j8imI", "Purpose"],
  ["Baby", "Justin Bieber ft. Ludacris", "Pop", 2010, 1, "kffacxfA7G4", "My World 2.0"],
  ["Sugar", "Maroon 5", "Pop", 2015, 2, "09R8_2nJtjg", "V"],
  ["Memories", "Maroon 5", "Pop", 2019, 1, "SlPhMPnQ58k", "Jordi"],
  ["Girls Like You", "Maroon 5 ft. Cardi B", "Pop", 2018, 2, "aJOTlE1K90k", "Red Pill Blues"],
  ["Lose Yourself", "Eminem", "Hip hop", 2002, 3, "_Yhyp-_hX2s", "8 Mile"],
  ["Without Me", "Eminem", "Hip hop", 2002, 3, "YVkUvmDQ3HY", "The Eminem Show"],
  ["Mockingbird", "Eminem", "Hip hop", 2004, 3, "S9bCLPwzSC0", "Encore"],
  ["bad guy", "Billie Eilish", "Electropop", 2019, 2, "DyDfgMOUjCI", "When We All Fall Asleep, Where Do We Go?"],
  ["lovely", "Billie Eilish & Khalid", "Balada", 2018, 1, "V1Pl8CzNzCw", "13 Reasons Why (Season 2)"],
  ["What Was I Made For?", "Billie Eilish", "Balada", 2023, 1, "cW8VLC9nnTo", "Barbie The Album"],
  ["Rocket Man", "Elton John", "Rock", 1972, 2, "DtVBCG6ThDk", "Honky Château"],
  ["I'm Still Standing", "Elton John", "Pop rock", 1983, 2, "ZHwVBirqD2s", "Too Low for Zero"],
  ["Your Song", "Elton John", "Balada", 1970, 1, null, "Elton John"],
  ["Dancing Queen", "ABBA", "Disco", 1976, 1, "xFrGuyw1V8s", "Arrival"],
  ["Mamma Mia", "ABBA", "Pop", 1975, 1, "unfzfe8f9NI", "ABBA"],
  ["The Winner Takes It All", "ABBA", "Balada", 1980, 2, "iyIOl-s7JTU", "Super Trouper"],
  ["I Will Always Love You", "Whitney Houston", "Balada", 1992, 1, "3JWTaaS7LdU", "The Bodyguard"],
  ["I Wanna Dance with Somebody", "Whitney Houston", "Pop", 1987, 1, "eH3giaIzONA", "Whitney"],
  ["Livin' on a Prayer", "Bon Jovi", "Rock", 1986, 2, "lDK9QqIzhwk", "Slippery When Wet"],
  ["It's My Life", "Bon Jovi", "Rock", 2000, 1, "vx2u5uUu3DE", "Crush"],
  ["Let It Be", "The Beatles", "Rock", 1970, 1, "QDYfEBY9NM4", "Let It Be"],
  ["Hey Jude", "The Beatles", "Rock", 1968, 1, "A_MjCqQoLLA", "Hey Jude (single)"],
  ["Here Comes the Sun", "The Beatles", "Rock", 1969, 1, "KQetemT1sWc", "Abbey Road"],
  ["Yesterday", "The Beatles", "Balada", 1965, 1, null, "Help!"],
  ["Numb", "Linkin Park", "Rock alternativo", 2003, 2, "kXYiU_JCYtU", "Meteora"],
  ["In the End", "Linkin Park", "Rock alternativo", 2000, 2, "eVTXPUF4Oz4", "Hybrid Theory"],
  ["Happy", "Pharrell Williams", "Pop", 2013, 1, "ZbZSe6N_BXs", "G I R L"],
  ["Roar", "Katy Perry", "Pop", 2013, 1, "CevxZvSJLk8", "Prism"],
  ["Firework", "Katy Perry", "Pop", 2010, 1, "QGJuMBdaqIw", "Teenage Dream"],
  ["Bad Romance", "Lady Gaga", "Electropop", 2009, 2, "qrO4YZeyl0I", "The Fame Monster"],
  ["Shallow", "Lady Gaga & Bradley Cooper", "Balada", 2018, 1, "bo_efYhYU2A", "A Star Is Born"],
  ["Levitating", "Dua Lipa", "Dance pop", 2020, 2, "TUVcZfQe-Kw", "Future Nostalgia"],
  ["New Rules", "Dua Lipa", "Dance pop", 2017, 1, "k2qgadSvNyU", "Dua Lipa"],
  ["As It Was", "Harry Styles", "Synth-pop", 2022, 2, "H5v3kku4y6Q", "Harry's House"],
  ["drivers license", "Olivia Rodrigo", "Balada", 2021, 1, "ZmDBbnmKpqQ", "SOUR"],
  ["Flowers", "Miley Cyrus", "Pop", 2023, 1, "G7KNmW9a75Y", "Endless Summer Vacation"],
  ["Someone You Loved", "Lewis Capaldi", "Balada", 2018, 1, "zABLecsR5UE", "Divinely Uninspired to a Hellish Extent"],
  ["Señorita", "Shawn Mendes & Camila Cabello", "Pop", 2019, 1, "Pkh8UtuejGw", "Señorita (single)"],
  ["Chandelier", "Sia", "Electropop", 2014, 2, "2vjPBrBU-TM", "1000 Forms of Fear"],
  ["Counting Stars", "OneRepublic", "Pop rock", 2013, 2, "hT_nvWreIhg", "Native"],
  ["Wake Me Up", "Avicii", "Electrónica", 2013, 1, "IcrbM1l_BoI", "True"],
  ["Don't Stop Believin'", "Journey", "Rock", 1981, 2, "1k8craCGpgs", "Escape"],
  ["Africa", "Toto", "Soft rock", 1982, 2, "FTQbiNvZqaY", "Toto IV"],
  ["Take On Me", "a-ha", "Synth-pop", 1985, 2, "djV11Xbc914", "Hunting High and Low"],
  ["Smells Like Teen Spirit", "Nirvana", "Grunge", 1991, 3, "hTWKbfoikeg", "Nevermind"],
  ["Sweet Child O' Mine", "Guns N' Roses", "Hard rock", 1987, 2, "1w7OgIMMRc4", "Appetite for Destruction"],
  ["Wonderwall", "Oasis", "Britpop", 1995, 2, "bx1Bh8ZvH84", "(What's the Story) Morning Glory?"],
  ["Eye of the Tiger", "Survivor", "Rock", 1982, 2, "btPJPFnesV4", "Eye of the Tiger"],
  ["Somebody That I Used to Know", "Gotye ft. Kimbra", "Indie pop", 2011, 2, "8UVNT4wvIGY", "Making Mirrors"],
  ["All of Me", "John Legend", "Balada", 2013, 1, "450p7goxZqg", "Love in the Future"],
  ["7 rings", "Ariana Grande", "Pop", 2019, 3, "QYh6mYIJG2Y", "thank u, next"],
  ["Sunflower", "Post Malone & Swae Lee", "Hip hop", 2018, 2, "ApXoWvfEYVU", "Spider-Man: Into the Spider-Verse"],
  ["Stayin' Alive", "Bee Gees", "Disco", 1977, 2, "fNFzfwLM72c", "Saturday Night Fever"],
  ["Girls Just Want to Have Fun", "Cyndi Lauper", "Pop", 1983, 1, "PIb6AZdTr-A", "She's So Unusual"],
  ["I Want It That Way", "Backstreet Boys", "Pop", 1999, 1, "4fndeDfaWCg", "Millennium"],
  ["...Baby One More Time", "Britney Spears", "Pop", 1998, 1, "C-u5WLJ9Yk4", "...Baby One More Time"],
  ["Wannabe", "Spice Girls", "Pop", 1996, 2, "gJLIiF15wjQ", "Spice"],
  ["Imagine", "John Lennon", "Balada", 1971, 1, "YkgkThdzX-8", "Imagine"],
  ["Every Breath You Take", "The Police", "Rock", 1983, 1, "OMOGaugKpzs", "Synchronicity"],
  ["Halo", "Beyoncé", "R&B", 2008, 1, "bnVUHWCynig", "I Am... Sasha Fierce"],
  ["Take Me to Church", "Hozier", "Indie rock", 2013, 3, "PVjiKRfKpPI", "Hozier"],
  ["Heat Waves", "Glass Animals", "Indie pop", 2020, 2, "mRD0-GxqHVo", "Dreamland"],
];

const slug = (s) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const LEVELS = { 1: "Principiante", 2: "Intermedio", 3: "Avanzado" };

/** Separa "A ft. B" / "A & B" en artistas individuales. */
export function splitArtists(artist) {
  return artist.split(/\s+(?:ft\.|feat\.|&|x|and)\s+|,\s*/i).map((a) => a.trim()).filter(Boolean);
}

export const CATALOG = RAW.map(([title, artist, genre, year, level, yt, album], i) => ({
  id: `c${String(i + 1).padStart(3, "0")}`,
  rank: i + 1,
  title,
  artist,
  artists: splitArtists(artist),
  genre,
  year,
  level,
  album,
  ytCandidate: yt || null,
  source: "catalog",
  searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${artist} ${title} official video`)}`,
  slug: slug(`${artist}-${title}`),
}));
