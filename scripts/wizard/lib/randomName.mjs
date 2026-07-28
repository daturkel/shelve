// A small adjective-noun name generator for suggesting a Cloudflare Pages
// project name — Pages project names are unique across *every* Cloudflare
// account, not just the current one, so a fixed suggestion like "shelve-web"
// is close to guaranteed to already be taken by someone else's deployment
// (including this project's own — see README.md/SETUP.md). Randomizing
// the suggestion doesn't guarantee availability either, but it's a much
// better starting point than a name every self-hoster would otherwise try
// first, and ensurePagesProjectExists() (see exec.mjs) recovers gracefully
// if it turns out to collide anyway.
const ADJECTIVES = [
  "amber",
  "brave",
  "calm",
  "cosmic",
  "curious",
  "dusty",
  "eager",
  "gentle",
  "golden",
  "jolly",
  "lively",
  "lucky",
  "mellow",
  "misty",
  "nimble",
  "quiet",
  "rustic",
  "sunny",
  "swift",
  "wandering",
];

const NOUNS = [
  "badger",
  "canyon",
  "comet",
  "falcon",
  "harbor",
  "juniper",
  "lantern",
  "meadow",
  "otter",
  "pebble",
  "raven",
  "ridge",
  "sparrow",
  "thicket",
  "tundra",
  "violet",
  "willow",
  "wren",
];

export function randomProjectName() {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  // A two-digit suffix (00-99) takes this from 360 combinations to 36,000 —
  // still no uniqueness guarantee, just a further-reduced collision chance
  // on top of ensurePagesProjectExists()'s actual retry-on-collision
  // recovery (see exec.mjs), which is what makes collisions non-fatal.
  const suffix = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${adjective}-${noun}-${suffix}`;
}
