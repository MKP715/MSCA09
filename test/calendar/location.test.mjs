// The Location line of a Google Calendar entry, read by parseLocation (src/_lib/calendar.js). Search engines get an
// event's Event data only when its Location gives a street or a city (calJsonLd in src/_lib/plugins/calendar.js), so a
// state the parser does not know costs the event its Event data. Run: npm run test:calendar
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation } from "../../src/_lib/calendar.js";

const pick = (raw) => {
  const { venue, street, city, state, zip, country } = parseLocation(raw);
  return { venue, street, city, state, zip, country };
};

test("a state outside the old list: St. Louis, MO (the 2030 International Convention)", () => {
  assert.deepEqual(pick("St. Louis, MO"), { venue: null, street: null, city: "St. Louis", state: "MO", zip: null, country: null });
});

test("New Mexico, which already worked", () => {
  assert.deepEqual(pick("Albuquerque, NM"), { venue: null, street: null, city: "Albuquerque", state: "NM", zip: null, country: null });
  assert.equal(pick("Albuquerque Convention Center, 401 2nd St NW, Albuquerque, NM 87102").zip, "87102");
});

test("a street part ending in St is not a state", () => {
  assert.deepEqual(pick("Main St, Portland, OR"), { venue: "Main St", street: null, city: "Portland", state: "OR", zip: null, country: null });
  assert.deepEqual(pick("Oregon Convention Center, 777 NE Martin Luther King Jr Blvd, Portland, OR 97232"), {
    venue: "Oregon Convention Center", street: "777 NE Martin Luther King Jr Blvd", city: "Portland", state: "OR", zip: "97232", country: null,
  });
});

test("California and Nevada, as typed in today's calendar, read as before", () => {
  assert.deepEqual(pick("Imperial Alano Club, 8021 Rosecrans Ave, Paramount, CA 90723"), {
    venue: "Imperial Alano Club", street: "8021 Rosecrans Ave", city: "Paramount", state: "CA", zip: "90723", country: null,
  });
  assert.deepEqual(pick("Sea Country Senior & Community Center, 24602 Aliso Creek Road, Laguna Niguel, California 92677"), {
    venue: "Sea Country Senior & Community Center", street: "24602 Aliso Creek Road", city: "Laguna Niguel", state: "CA", zip: "92677", country: null,
  });
  assert.equal(pick("El Dorado Park, 2760 N Studebaker Rd, Long Beach, California").state, "CA");
  assert.deepEqual(pick("Westgate, 3000 Paradise Rd, Las Vegas, NV 89109, USA"), {
    venue: "Westgate", street: "3000 Paradise Rd", city: "Las Vegas", state: "NV", zip: "89109", country: "USA",
  });
  assert.equal(pick("Reno, Nevada").state, "NV");
  // no state at all: a lone city, or a street and city with a ZIP code
  assert.deepEqual(pick("Fullerton"), { venue: null, street: null, city: "Fullerton", state: null, zip: null, country: null });
});

test("a two-letter code counts only in capitals: a lone lower-case 'in' or 'or' is not a state", () => {
  assert.deepEqual(pick("Fellowship Hall, in, 123 Main St, Anaheim, CA 92801"), {
    venue: "Fellowship Hall", street: "123 Main St", city: "Anaheim", state: "CA", zip: "92801", country: null,
  });
  assert.equal(pick("Back patio, in, Fullerton").state, null);
  assert.equal(pick("Upstairs, or, Garden Grove").state, null);
  assert.equal(pick("Riverside, ca").state, null);
});

test("full state names in any case, D.C., and the last state wins", () => {
  assert.equal(pick("Atlanta, Georgia").state, "GA");
  assert.equal(pick("Seattle, washington").state, "WA");
  assert.deepEqual(pick("New York, NY"), { venue: null, street: null, city: "New York", state: "NY", zip: null, country: null });
  assert.deepEqual(pick("Washington, D.C."), { venue: null, street: null, city: "Washington", state: "DC", zip: null, country: null });
  assert.deepEqual(pick("Denver, CO 80202"), { venue: null, street: null, city: "Denver", state: "CO", zip: "80202", country: null });
});

test("Canadian provinces: by code, or by name before Canada; Ontario, California stays a city", () => {
  assert.deepEqual(pick("Toronto, ON, Canada"), { venue: null, street: null, city: "Toronto", state: "ON", zip: null, country: "Canada" });
  assert.equal(pick("Montréal, Québec, Canada").state, "QC");
  assert.equal(pick("Vancouver, BC V6B 1A1").zip, "V6B 1A1");
  assert.deepEqual(pick("Ontario"), { venue: null, street: null, city: "Ontario", state: null, zip: null, country: null });
  assert.deepEqual(pick("Ontario Convention Center, 2000 E Convention Center Way, Ontario, CA 91764"), {
    venue: "Ontario Convention Center", street: "2000 E Convention Center Way", city: "Ontario", state: "CA", zip: "91764", country: null,
  });
});

test("LA on its own is Los Angeles, not Louisiana", () => {
  assert.equal(pick("Crypto.com Arena, LA").state, null);
  assert.equal(pick("New Orleans, LA 70112").state, "LA");
  assert.equal(pick("New Orleans, Louisiana").state, "LA");
});
