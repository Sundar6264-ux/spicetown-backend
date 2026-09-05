// The restaurant operates in America/New_York, and the dashboard may be
// viewed from a device set to a different timezone (e.g. checking in from
// out of town) - so timestamps are always shown in the restaurant's own
// timezone explicitly, rather than whatever the viewer's device happens to
// be set to. `timeZoneName: "short"` gives the correct EST/EDT label for the
// date in question, not just a fixed "ET".
//
// Note: combining dateStyle/timeStyle with timeZoneName isn't supported in
// all Intl implementations, so this spells out the fields explicitly instead.
const RESTAURANT_TIME_ZONE = "America/New_York";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: RESTAURANT_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatRestaurantTime(isoString) {
  if (!isoString) return null;
  return formatter.format(new Date(isoString));
}
