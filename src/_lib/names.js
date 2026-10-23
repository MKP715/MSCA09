// Full-name look-alikes ("Maria Gonzalez", where the site's rule is "Maria G."), shared by the site
// check (scripts/check-site.mjs, which refuses to publish them) and the document library
// (src/_data/documents.js, which shortens names in titles taken from the Area 09 Archives' file names).
//
//   nameHits(text)      → [{ name, ctx, index }] for every "First Surname" that is not allowed
//   shortenNames(text)  → the text with each of those surnames cut to its initial ("Maria G.")
//
// Allowed: venues, places, books and public figures listed in data/name-allowlist.csv.
import { readCsv } from "./csv.js";

// "Maria Gonzalez" (first name + capitalised word) where "Maria G." is the rule. Built from
// common first names plus the first names in data/trusted-servants.csv.
const COMMON_FIRST = `Aaron Adam Adrian Adriana Alan Albert Alberto Alejandra Alejandro Alex Alexander Alfonso Alfredo Alice Alicia Allen Alma Amanda Amber Amy Ana Andrea Andres Andrew Andy Angel Angela Angelica Angie Anita Ann Anna Anne Annie Anthony Antonio Armando Arthur Arturo Ashley Barbara Ben Benjamin Bernard Beth Betty Bill Billy Blanca Bob Bobby Brad Brandon Brenda Brent Brian Bruce Bryan Carl Carla Carlos Carmen Carol Carolina Caroline Carrie Catherine Cathy Cecilia Cesar Chad Charles Charlie Cheryl Chris Christian Christina Christine Christopher Chuck Cindy Claudia Clyde Colleen Connie Craig Cristina Crystal Cyndi Cynthia Dale Dan Dana Daniel Daniela Danny Darlene Dave David Dawn Dean Debbie Deborah Debra Denise Dennis Diana Dick Diane Diego Dolores Don Donald Donna Doris Dorothy Doug Douglas Eddie Edgar Eduardo Edward Elbert Elena Elizabeth Ellen Ellery Emily Emma Enrique Eric Erica Erik Ernesto Esther Eugene Evelyn Fay Fernando Frances Francisco Frank Fred Gabriel Gabriela Gary Gene Genevieve George Gerardo Gina Glen Glenn Gloria Goldene Gordon Grace Greg Gregory Guadalupe Guillermo Gustavo Harold Harry Hector Heather Helen Henry Hugo Ignacio Irene Isabel Jack Jackie Jacob Jaime James Jamie Jane Janet Janice Jason Javier Jay Jean Jeff Jeffrey Jennifer Jenny Jeremy Jerry Jesse Jessica Jesus Jim Jimmy Joan Joanne Joe Joel John Johnny Jon Jonathan Jorge Jose Joseph Josh Joshua Joyce Juan Juana Judy Julia Julie Julio Justin Karen Kate Katherine Kathleen Kathy Katie Keith Kelly Ken Kenneth Kevin Kim Kimberly Kirby Kristen Kurt Larry Laura Lauren Leo Leonard Leticia Linda Lionel Lisa Lori Lorraine Louis Lucy Luis Lupe Manuel Marco Marcos Margaret Maria Marie Mario Marilyn Mark Martha Martin Mary Matt Matthew Maureen Maxine Melissa Michael Michelle Miguel Mike Monica Nancy Nicole Norma Odene Ollie Oscar Ozzie Pablo Pam Pamela Patricia Patrick Paul Paula Pedro Peggy Peter Phil Phillip Rachel Rafael Ralph Ramon Randy Raquel Raymond Rebecca Rene Ricardo Richard Rick Rita Robert Roberto Robin Rocio Rodolfo Roger Ron Ronald Rosa Rose Ruben Russell Ruth Ryan Sally Salvador Samuel Sandra Sandy Sara Sarah Scott Sergio Sharon Shawn Sheila Shirley Silvia Sonia Stacy Stephanie Stephen Steve Steven Stu Susan Suzanne Tammy Tara Teresa Terri Terry Thomas Timothy Tina Todd Tommy Tony Tracy Valerie Veronica Vicki Victor Victoria Vincent Virginia Walter Wanda Wayne Wendy William Yolanda`.split(/\s+/);
const servants = readCsv("trusted-servants.csv");
const FIRST = new Set(COMMON_FIRST);
for (const r of servants) {
  const f = (r.name || "").trim().split(/\s+/)[0];
  if (f && /^[\p{Lu}][\p{Ll}]{2,}$/u.test(f)) FIRST.add(f);
}
// Second given names in a double first name ("Mary Ann W.", "Lisa Marie P."): the surname is the word after them.
const SECOND_FIRST = new Set(`Ann Anne Marie Jo Lou Lynn Lynne Sue Kay Jean Beth Ellen Louise Rose Mae Elena Luisa`.split(/\s+/));
// Words that make "First Word" a place, a venue, a book or a role rather than a person.
const NOT_SURNAME = new Set(
  `Area District Distrito Committee Comité Panel Zoom Service Servicio General Conference Delegate Alternate Chair Secretary Treasurer Registrar Grapevine Vina Viña Archives The Long Beach North South East West Central Office Church Avenue Ave Street Blvd Road Drive Way Park Valley Hills Hall Club Center Room Hospital Monday Tuesday Wednesday Thursday Friday Saturday Sunday County Island Point Lake Mountain Mountains Springs City Desert College University School Hispanic Spanish English Inter Intergroup Hotel Community Fellowship Alano Foundation Unity Hope Serenity Sobriety Recovery Pacific Regional Forum Trustee Board Workshop Assembly Meeting Methodist Lutheran Catholic Baptist Presbyterian Episcopal Memorial Hill Bay Harbor Mission Grove Airport Plaza Square Library Building Centre Ranch Canyon Estates Village Heights Gardens Station Fire Police Senior Citizens Mesa Verde Palms Cove Bernardino Clemente Jacinto Angeles Cruz Washington Lincoln Kennedy Lane Court Highway Fwy Pkwy Auditorium Group Groups Steps Traditions Concepts Big Book Twelve Unidos Grupo Rancho Pre Post Report Reports Minutes News Study Tree Sees Leaders Past Class Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec January February April June July August September October November December Enero Febrero Marzo Abril Mayo Junio Julio Agosto Septiembre Octubre Noviembre Diciembre`.split(/\s+/),
);
const PLACE_BEFORE = /\b(San|Santa|Santo|St|Saint|Los|Las|El|La|Lake|Mount|Mt|Fort|Port|Point|Rancho|Laguna|Dana)\.?\s+$/;
// "Memorial" is a venue only before a venue word ("Veterans Memorial Hall"), not in "Bill Wilson Memorial Fund".
const VENUE_AFTER = /^\s+(Park|Center|Centre|Community|Hall|Gym|Sports|Road|Rd|Street|St|Avenue|Ave|Blvd|Church|School|Library|Building|Room|Plaza|Memorial\s+(?:Hall|Park|Church|Hospital|Center|Centre|Library|Stadium|Building|Auditorium|Coliseum|Field|Gardens?)|Elementary|High|Middle|Recreation|Senior|Auditorium|Field|Stadium|Hospital|Medical|Clinic|Way|Drive|Dr|Lane|Ln|Court|Ct|Trail|Tr)\b/;
const nameAllow = readCsv("name-allowlist.csv")
  .map((r) => (r.phrase || "").trim())
  .filter(Boolean);
const SURNAME = "(?:Mc|Mac|O'|O’)?\\p{Lu}\\p{Ll}{2,}(?:-\\p{Lu}?\\p{Ll}+)?";
// First name, then the surname. (A middle initial is not matched: after "Linda C." the next capitalised word is
// usually not a surname — "Linda C. Updated Group Forms".)
const NAME_RE = new RegExp(`\\b(${[...FIRST].sort((a, b) => b.length - a.length).join("|")})()? (${SURNAME})(?![\\p{L}])`, "gu");
const FIRST_ALT = [...FIRST].sort((a, b) => b.length - a.length).join("|");
const FIRST_BRACKET = new RegExp(`\\b(${FIRST_ALT}) \\(((?:Mc|Mac)?\\p{Lu}\\p{Ll}{2,})\\)`, "gu");
const FIRST_INITIAL_BRACKET = new RegExp(`\\b(${FIRST_ALT}) (\\p{Lu})\\(\\p{Ll}+\\)`, "gu");
export function nameHits(text) {
  const hits = [];
  for (const m of text.matchAll(NAME_RE)) {
    if (NOT_SURNAME.has(m[3])) continue;
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (PLACE_BEFORE.test(before) || VENUE_AFTER.test(after)) continue;
    if (/^\s+\p{Lu}\.(?!\p{L})/u.test(after)) continue; // "Lisa Marie P." — first names + last initial
    const ctx = text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 40).replace(/\s+/g, " ");
    if (nameAllow.some((p) => ctx.includes(p))) continue;
    hits.push({ name: m[0], ctx, index: m.index, first: m[1] + (m[2] || ""), last: m[3] });
  }
  return hits;
}

/** "Letter Jack Reilly to Linda Clough" → "Letter Jack R. to Linda C." (allowed names are left alone). */
export function shortenNames(text) {
  // "Patricia (Painter)" and "Linda H(enry)" — a surname in brackets, as in some file names.
  const s = String(text || "")
    .replace(FIRST_BRACKET, (m, first, last) => `${first} ${last[0].toUpperCase()}.`)
    .replace(FIRST_INITIAL_BRACKET, (m, first, initial) => `${first} ${initial}.`);
  const hits = nameHits(s);
  if (!hits.length) return s;
  let out = "";
  let at = 0;
  for (const h of hits) {
    if (h.index < at) continue;
    // "Mary Ann Warren": the second word is a first name too, so the surname is the word after it.
    const rest = s.slice(h.index + h.name.length);
    const next = SECOND_FIRST.has(h.last) && rest.match(/^ ((?:Mc|Mac|O'|O’)?\p{Lu}\p{Ll}{2,}(?:-\p{Lu}?\p{Ll}+)?)(?![\p{L}])/u);
    if (next && !NOT_SURNAME.has(next[1])) {
      out += s.slice(at, h.index) + `${h.first} ${h.last} ${next[1][0].toUpperCase()}.`;
      at = h.index + h.name.length + next[0].length;
    } else {
      out += s.slice(at, h.index) + `${h.first} ${h.last[0].toUpperCase()}.`;
      at = h.index + h.name.length;
    }
  }
  return out + s.slice(at);
}

// ---------------------------------------------------------------- titles taken from the Area 09 Archives' file names
// The first-name list cannot know every name in sixty years of file names ("Letter Ozzie Falk to …"), so titles built
// from the Archives' file names get a second pass that does not need it: a "Name Surname" pair right after a word
// that introduces a person, or at the start of a title before " to ", is shortened too.
const NOT_A_PERSON = new Set(
  `${[...NOT_SURNAME].join(" ")} Members Member Officers Officer Delegates All Each Every Our Your His Her Their Dear New Old Proposed Revised Final Draft Executive Southern Northern California Orange Riverside Coastal Hospitals Institutions Literature Public Information Cooperation Corrections Treatment Special Needs Young People Women Womens Men Mens Agenda Motion Motions Budget Finance Financial Guidelines Bylaws Policy Policies Ad Hoc Steering Election Elections Nominating Host Hosting Planning Convention Conventions Roundup Seminar Symposium Sharing Session Workshop Workshops Open House Heritage Day Days Founders Anniversary Banquet Picnic Dinner Breakfast Luncheon Speaker Speakers Panel Panels Questionnaire Survey Results Proposal Proposals Request Response Reply Thank Thanks Welcome Updated Update Updates Notes Note Letter Memo Email Flyer Map Maps Directory Program Programs Schedule Calendar Calendars Archives Archivist Inventory Collection Tape Tapes Recording Recordings Video Videos Photo Photos Picture Pictures History Histories Article Articles Newsletter Newsletters Bulletin Booklet Pamphlet Brochure Typescript Document Documents Reading Readings Webpage Interview Interviews Interviewed San Santa Santo Saint Los Las El La Del Big Loma Grand Laguna Rancho Palos Yorba Pico Indian Lake Mount Fort Port Diamond Chino Moreno Garden Buena Fountain Costa Huntington Newport Redondo Hermosa Manhattan Seal Cathedral Yucca Apple Victor Desert Twentynine Coachella Palm Sun Bear Simi Thousand Upland Ontario Corona Signal Harbor Inland Empire Orange Imperial Alcoholics Anonymous Dr Rev Father Sister Brother Judge Handwritten Typed Typewritten Original Copy Copies Personal Legal Yellow White Guide Questions Question Answers Elder Elderly Community Communitity Liberty Bell Bells Zig Zag Friendship Freedom Serenity Sunrise Sunset Happy Hour Early Bird Birds Step Study Discussion Speaker Candlelight Candle Light Attitude Adjustment Into Action`.split(/\s+/),
);
// "Letter Name Surname", "Memo from Name Surname", "Interviewed by Name Surname"; "to Name Surname" only in letters,
// memos, notes and e-mails (elsewhere "to" is too often followed by a place or a title).
const PERSON_AFTER = new RegExp(`(\\b(?:Letter|Letters|Memo|Note|Notes|E-?mail|Fax|Card|From|from|By|by|Interviewed by|interviewed by|Interview with|interview with))( )(\\p{Lu}\\p{Ll}+) (${SURNAME})(?![\\p{L}])`, "gu");
const PERSON_TO = new RegExp(`(\\b(?:To|to))( )(\\p{Lu}\\p{Ll}+) (${SURNAME})(?![\\p{L}])`, "gu");
const LETTERISH = /\b(Letter|Letters|Memo|Note|Notes|E-?mail|Fax|Card)\b/;

/** shortenNames, plus the pattern pass for titles that come from the Archives' file names. */
export function shortenArchiveNames(text) {
  let s = shortenNames(text);
  const allowed = (ctx) => nameAllow.some((p) => ctx.includes(p));
  const cut = (m, intro, sp, first, last, off, whole) => {
    if (NOT_A_PERSON.has(first) || NOT_A_PERSON.has(last)) return m;
    if (allowed(whole.slice(Math.max(0, off - 20), off + m.length + 20))) return m;
    return `${intro}${sp}${first} ${last[0]}.`;
  };
  s = s.replace(PERSON_AFTER, cut);
  if (LETTERISH.test(s)) s = s.replace(PERSON_TO, cut);
  return s;
}

/** Does an Archives title still look like "Letter Name Surname" after shortening? (for a build warning) */
const RISK_RE = /\b(?:Letter|Memo|Note|E-?mail)\s+(\p{Lu}\p{Ll}+)\s+(\p{Lu}\p{Ll}{2,})(?![\p{L}])/gu;
export function archiveNameRisk(title) {
  for (const m of String(title || "").matchAll(RISK_RE)) {
    if (!NOT_A_PERSON.has(m[1]) && !NOT_A_PERSON.has(m[2]) && !nameAllow.some((p) => title.includes(p))) return true;
  }
  return false;
}
