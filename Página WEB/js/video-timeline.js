// Reglas de recorte de BAT Montaje. Los tiempos internos están en milisegundos.
export const eventTypes = ['Kill', 'Combate', 'Otro'];
export const maxSourceDuration = 20 * 60 * 1000;
export const maxMontageBytes = 100 * 1024 * 1024;
export const defaultBefore = 7;
export const defaultAfter = 3;

export function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

export function parseTime(input) {
  const value = input.trim();
  const time = /^\d{1,4}$/.test(value) ? value.padStart(3, '0').replace(/(\d\d)$/, ':$1') : value;
  const parsed = time.match(/^(\d{1,2}):([0-5]\d)$/);
  return parsed ? (Number(parsed[1]) * 60 + Number(parsed[2])) * 1000 : NaN;
}

export function validEvent(event, duration) {
  return eventTypes.includes(event.type) && Number.isInteger(event.start) && Number.isInteger(event.end)
    && event.start >= 0 && event.end >= event.start && event.end <= duration
    && (event.type !== 'Combate' || event.end > event.start)
    && (event.type !== 'Otro' || Boolean(event.name))
    && [event.before, event.after].every(value => Number.isInteger(value) && value >= 0 && value <= 600);
}

export function mergedRanges(events, duration) {
  const ranges = events.filter(event => validEvent(event, duration)).map(event => [
    Math.max(0, event.start - event.before * 1000), Math.min(duration, event.end + event.after * 1000),
  ]).filter(([start, end]) => start < end).sort(([left], [right]) => left - right);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1] + 350) previous[1] = Math.max(previous[1], range[1]);
    else merged.push(range);
  }
  return merged;
}
