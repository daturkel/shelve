// Minimal ANSI styling — no chalk/kleur dependency for something used only
// at setup/upgrade time. Colors are skipped entirely on a non-TTY stdout or
// when NO_COLOR is set, so piping/logging output never gets escape-code
// garbage.
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const codes = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  cyan: "36",
};

function wrap(code, text) {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const bold = (text) => wrap(codes.bold, text);
export const dim = (text) => wrap(codes.dim, text);
export const red = (text) => wrap(codes.red, text);
export const green = (text) => wrap(codes.green, text);
export const yellow = (text) => wrap(codes.yellow, text);
export const cyan = (text) => wrap(codes.cyan, text);

export function heading(text) {
  console.log(`\n${bold(cyan(`── ${text} `.padEnd(60, "─")))}`);
}

export function step(text) {
  console.log(bold(text));
}

export function info(text) {
  console.log(dim(text));
}

export function success(text) {
  console.log(green(`✔ ${text}`));
}

export function warn(text) {
  console.log(yellow(`⚠ ${text}`));
}

export function error(text) {
  console.error(red(`✘ ${text}`));
}
