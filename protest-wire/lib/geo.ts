// Small offline gazetteer: country names (EN / Serbian Latin) with rough centroids, and cities
// people can pick for "I'm in". Coordinates are approximate on purpose (city level, never precise).

export interface Country { code: string; en: string; sr: string; lat: number; lon: number }
export interface City { key: string; en: string; sr: string; country: string; lat: number; lon: number }

const C = (code: string, en: string, sr: string, lat: number, lon: number): Country => ({ code, en, sr, lat, lon });

export const COUNTRIES: Country[] = [
  C("RS", "Serbia", "Srbija", 44.0, 20.9), C("XK", "Kosovo", "Kosovo", 42.6, 20.9),
  C("BA", "Bosnia and Herzegovina", "Bosna i Hercegovina", 44.2, 17.8), C("HR", "Croatia", "Hrvatska", 45.1, 15.2),
  C("ME", "Montenegro", "Crna Gora", 42.7, 19.4), C("MK", "North Macedonia", "Severna Makedonija", 41.6, 21.7),
  C("SI", "Slovenia", "Slovenija", 46.1, 14.8), C("AL", "Albania", "Albanija", 41.2, 20.2),
  C("BG", "Bulgaria", "Bugarska", 42.7, 25.5), C("RO", "Romania", "Rumunija", 45.9, 24.97),
  C("HU", "Hungary", "Mađarska", 47.2, 19.5), C("GR", "Greece", "Grčka", 39.1, 21.8),
  C("TR", "Türkiye", "Turska", 39.0, 35.2), C("GE", "Georgia", "Gruzija", 42.3, 43.4),
  C("AM", "Armenia", "Jermenija", 40.1, 45.0), C("AZ", "Azerbaijan", "Azerbejdžan", 40.1, 47.6),
  C("UA", "Ukraine", "Ukrajina", 48.4, 31.2), C("BY", "Belarus", "Belorusija", 53.7, 27.9),
  C("RU", "Russia", "Rusija", 61.5, 105.3), C("MD", "Moldova", "Moldavija", 47.4, 28.4),
  C("PL", "Poland", "Poljska", 51.9, 19.1), C("SK", "Slovakia", "Slovačka", 48.7, 19.7),
  C("CZ", "Czechia", "Češka", 49.8, 15.5), C("AT", "Austria", "Austrija", 47.5, 14.6),
  C("DE", "Germany", "Nemačka", 51.2, 10.4), C("FR", "France", "Francuska", 46.2, 2.2),
  C("ES", "Spain", "Španija", 40.5, -3.7), C("PT", "Portugal", "Portugalija", 39.4, -8.2),
  C("IT", "Italy", "Italija", 41.9, 12.6), C("CH", "Switzerland", "Švajcarska", 46.8, 8.2),
  C("NL", "Netherlands", "Holandija", 52.1, 5.3), C("BE", "Belgium", "Belgija", 50.5, 4.5),
  C("GB", "United Kingdom", "Ujedinjeno Kraljevstvo", 55.4, -3.4), C("IE", "Ireland", "Irska", 53.4, -8.2),
  C("SE", "Sweden", "Švedska", 60.1, 18.6), C("NO", "Norway", "Norveška", 60.5, 8.5),
  C("DK", "Denmark", "Danska", 56.3, 9.5), C("FI", "Finland", "Finska", 61.9, 25.7),
  C("US", "United States", "Sjedinjene Američke Države", 39.8, -98.6), C("CA", "Canada", "Kanada", 56.1, -106.3),
  C("MX", "Mexico", "Meksiko", 23.6, -102.6), C("CU", "Cuba", "Kuba", 21.5, -78.0),
  C("VE", "Venezuela", "Venecuela", 6.4, -66.6), C("CO", "Colombia", "Kolumbija", 4.6, -74.3),
  C("EC", "Ecuador", "Ekvador", -1.8, -78.2), C("PE", "Peru", "Peru", -9.2, -75.0),
  C("BO", "Bolivia", "Bolivija", -16.3, -63.6), C("CL", "Chile", "Čile", -35.7, -71.5),
  C("AR", "Argentina", "Argentina", -38.4, -63.6), C("BR", "Brazil", "Brazil", -14.2, -51.9),
  C("PY", "Paraguay", "Paragvaj", -23.4, -58.4), C("UY", "Uruguay", "Urugvaj", -32.5, -55.8),
  C("GT", "Guatemala", "Gvatemala", 15.8, -90.2), C("HN", "Honduras", "Honduras", 15.2, -86.2),
  C("NI", "Nicaragua", "Nikaragva", 12.9, -85.2), C("PA", "Panama", "Panama", 8.5, -80.8),
  C("HT", "Haiti", "Haiti", 19.0, -72.3), C("DO", "Dominican Republic", "Dominikanska Republika", 18.7, -70.2),
  C("MA", "Morocco", "Maroko", 31.8, -7.1), C("DZ", "Algeria", "Alžir", 28.0, 1.7),
  C("TN", "Tunisia", "Tunis", 33.9, 9.5), C("LY", "Libya", "Libija", 26.3, 17.2),
  C("EG", "Egypt", "Egipat", 26.8, 30.8), C("SD", "Sudan", "Sudan", 12.9, 30.2),
  C("ET", "Ethiopia", "Etiopija", 9.1, 40.5), C("KE", "Kenya", "Kenija", -0.02, 37.9),
  C("UG", "Uganda", "Uganda", 1.4, 32.3), C("TZ", "Tanzania", "Tanzanija", -6.4, 34.9),
  C("NG", "Nigeria", "Nigerija", 9.1, 8.7), C("GH", "Ghana", "Gana", 7.9, -1.0),
  C("SN", "Senegal", "Senegal", 14.5, -14.5), C("CI", "Côte d'Ivoire", "Obala Slonovače", 7.5, -5.5),
  C("CM", "Cameroon", "Kamerun", 7.4, 12.4), C("CD", "DR Congo", "DR Kongo", -4.0, 21.8),
  C("TG", "Togo", "Togo", 8.6, 0.8), C("ML", "Mali", "Mali", 17.6, -4.0),
  C("ZA", "South Africa", "Južna Afrika", -30.6, 22.9), C("ZW", "Zimbabwe", "Zimbabve", -19.0, 29.2),
  C("MZ", "Mozambique", "Mozambik", -18.7, 35.5), C("MG", "Madagascar", "Madagaskar", -18.8, 46.9),
  C("IL", "Israel", "Izrael", 31.0, 34.9), C("PS", "Palestine", "Palestina", 31.9, 35.2),
  C("LB", "Lebanon", "Liban", 33.9, 35.9), C("SY", "Syria", "Sirija", 34.8, 39.0),
  C("JO", "Jordan", "Jordan", 30.6, 36.2), C("IQ", "Iraq", "Irak", 33.2, 43.7),
  C("IR", "Iran", "Iran", 32.4, 53.7), C("SA", "Saudi Arabia", "Saudijska Arabija", 23.9, 45.1),
  C("YE", "Yemen", "Jemen", 15.6, 48.5), C("PK", "Pakistan", "Pakistan", 30.4, 69.3),
  C("AF", "Afghanistan", "Avganistan", 33.9, 67.7), C("IN", "India", "Indija", 20.6, 79.0),
  C("BD", "Bangladesh", "Bangladeš", 23.7, 90.4), C("NP", "Nepal", "Nepal", 28.4, 84.1),
  C("LK", "Sri Lanka", "Šri Lanka", 7.9, 80.8), C("MM", "Myanmar", "Mjanmar", 21.9, 95.96),
  C("TH", "Thailand", "Tajland", 15.9, 100.99), C("KH", "Cambodia", "Kambodža", 12.6, 104.99),
  C("VN", "Vietnam", "Vijetnam", 14.1, 108.3), C("MY", "Malaysia", "Malezija", 4.2, 101.98),
  C("ID", "Indonesia", "Indonezija", -0.8, 113.9), C("PH", "Philippines", "Filipini", 12.9, 121.8),
  C("CN", "China", "Kina", 35.9, 104.2), C("HK", "Hong Kong", "Hongkong", 22.3, 114.2),
  C("TW", "Taiwan", "Tajvan", 23.7, 121.0), C("KR", "South Korea", "Južna Koreja", 35.9, 127.8),
  C("JP", "Japan", "Japan", 36.2, 138.3), C("MN", "Mongolia", "Mongolija", 46.9, 103.8),
  C("KZ", "Kazakhstan", "Kazahstan", 48.0, 66.9), C("AU", "Australia", "Australija", -25.3, 133.8),
  C("NZ", "New Zealand", "Novi Zeland", -40.9, 174.9),
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function country(code: string | null | undefined): Country | undefined {
  return code ? COUNTRY_BY_CODE.get(code.toUpperCase()) : undefined;
}

export function countryName(code: string, lang: "en" | "sr"): string {
  const c = country(code);
  return c ? (lang === "en" ? c.en : c.sr) : code;
}

/** Regional-indicator flag emoji from an ISO-3166 alpha-2 code. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code) || code.toUpperCase() === "XK") return code.toUpperCase() === "XK" ? "🏳️" : "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const T = (en: string, sr: string, cc: string, lat: number, lon: number): City => ({
  key: `${cc.toLowerCase()}-${en.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")}`,
  en, sr, country: cc, lat, lon,
});

export const CITIES: City[] = [
  // Serbia
  T("Belgrade", "Beograd", "RS", 44.817, 20.457), T("Novi Sad", "Novi Sad", "RS", 45.267, 19.833),
  T("Niš", "Niš", "RS", 43.321, 21.896), T("Kragujevac", "Kragujevac", "RS", 44.012, 20.911),
  T("Subotica", "Subotica", "RS", 46.1, 19.665), T("Zrenjanin", "Zrenjanin", "RS", 45.381, 20.39),
  T("Pančevo", "Pančevo", "RS", 44.871, 20.641), T("Čačak", "Čačak", "RS", 43.891, 20.35),
  T("Kraljevo", "Kraljevo", "RS", 43.724, 20.687), T("Novi Pazar", "Novi Pazar", "RS", 43.137, 20.512),
  T("Šabac", "Šabac", "RS", 44.756, 19.694), T("Valjevo", "Valjevo", "RS", 44.275, 19.898),
  T("Užice", "Užice", "RS", 43.856, 19.848), T("Smederevo", "Smederevo", "RS", 44.665, 20.928),
  T("Leskovac", "Leskovac", "RS", 42.998, 21.946), T("Vranje", "Vranje", "RS", 42.551, 21.9),
  T("Kruševac", "Kruševac", "RS", 43.58, 21.334), T("Sombor", "Sombor", "RS", 45.774, 19.112),
  T("Loznica", "Loznica", "RS", 44.534, 19.226), T("Jagodina", "Jagodina", "RS", 43.977, 21.261),
  T("Zaječar", "Zaječar", "RS", 43.904, 22.264), T("Pirot", "Pirot", "RS", 43.153, 22.586),
  T("Sremska Mitrovica", "Sremska Mitrovica", "RS", 44.976, 19.612), T("Kikinda", "Kikinda", "RS", 45.83, 20.465),
  // Region
  T("Sarajevo", "Sarajevo", "BA", 43.856, 18.413), T("Banja Luka", "Banja Luka", "BA", 44.772, 17.191),
  T("Zagreb", "Zagreb", "HR", 45.815, 15.982), T("Podgorica", "Podgorica", "ME", 42.441, 19.263),
  T("Skopje", "Skoplje", "MK", 41.998, 21.425), T("Ljubljana", "Ljubljana", "SI", 46.056, 14.505),
  T("Tirana", "Tirana", "AL", 41.327, 19.819), T("Sofia", "Sofija", "BG", 42.698, 23.322),
  T("Bucharest", "Bukurešt", "RO", 44.426, 26.103), T("Budapest", "Budimpešta", "HU", 47.498, 19.04),
  T("Athens", "Atina", "GR", 37.984, 23.728), T("Istanbul", "Istanbul", "TR", 41.008, 28.978),
  T("Ankara", "Ankara", "TR", 39.934, 32.86), T("Tbilisi", "Tbilisi", "GE", 41.716, 44.783),
  T("Yerevan", "Jerevan", "AM", 40.179, 44.499), T("Kyiv", "Kijev", "UA", 50.45, 30.523),
  T("Chișinău", "Kišinjev", "MD", 47.011, 28.863), T("Bratislava", "Bratislava", "SK", 48.149, 17.107),
  T("Prague", "Prag", "CZ", 50.075, 14.438), T("Warsaw", "Varšava", "PL", 52.23, 21.012),
  T("Vienna", "Beč", "AT", 48.208, 16.373),
  // Europe
  T("Berlin", "Berlin", "DE", 52.52, 13.405), T("Munich", "Minhen", "DE", 48.135, 11.582),
  T("Frankfurt", "Frankfurt", "DE", 50.11, 8.682), T("Paris", "Pariz", "FR", 48.857, 2.352),
  T("Marseille", "Marsej", "FR", 43.296, 5.37), T("Madrid", "Madrid", "ES", 40.417, -3.704),
  T("Barcelona", "Barselona", "ES", 41.385, 2.173), T("Lisbon", "Lisabon", "PT", 38.722, -9.139),
  T("Rome", "Rim", "IT", 41.903, 12.496), T("Milan", "Milano", "IT", 45.464, 9.19),
  T("Zurich", "Cirih", "CH", 47.377, 8.542), T("Amsterdam", "Amsterdam", "NL", 52.368, 4.904),
  T("Brussels", "Brisel", "BE", 50.85, 4.352), T("London", "London", "GB", 51.507, -0.128),
  T("Dublin", "Dablin", "IE", 53.35, -6.26), T("Stockholm", "Stokholm", "SE", 59.329, 18.069),
  T("Oslo", "Oslo", "NO", 59.914, 10.752), T("Copenhagen", "Kopenhagen", "DK", 55.676, 12.568),
  T("Helsinki", "Helsinki", "FI", 60.17, 24.938),
  // Americas
  T("New York", "Njujork", "US", 40.713, -74.006), T("Washington", "Vašington", "US", 38.907, -77.037),
  T("Chicago", "Čikago", "US", 41.878, -87.63), T("Los Angeles", "Los Anđeles", "US", 34.052, -118.244),
  T("San Francisco", "San Francisko", "US", 37.775, -122.419), T("Toronto", "Toronto", "CA", 43.653, -79.383),
  T("Montreal", "Montreal", "CA", 45.502, -73.567), T("Mexico City", "Meksiko Siti", "MX", 19.433, -99.133),
  T("Bogotá", "Bogota", "CO", 4.711, -74.072), T("Caracas", "Karakas", "VE", 10.48, -66.904),
  T("Quito", "Kito", "EC", -0.181, -78.468), T("Lima", "Lima", "PE", -12.046, -77.043),
  T("La Paz", "La Paz", "BO", -16.49, -68.119), T("Santiago", "Santjago", "CL", -33.449, -70.669),
  T("Buenos Aires", "Buenos Ajres", "AR", -34.604, -58.382), T("São Paulo", "Sao Paulo", "BR", -23.551, -46.633),
  T("Rio de Janeiro", "Rio de Žaneiro", "BR", -22.907, -43.173), T("Asunción", "Asunsion", "PY", -25.264, -57.576),
  // Africa & Middle East
  T("Rabat", "Rabat", "MA", 34.02, -6.842), T("Casablanca", "Kazablanka", "MA", 33.573, -7.59),
  T("Algiers", "Alžir", "DZ", 36.754, 3.059), T("Tunis", "Tunis", "TN", 36.806, 10.182),
  T("Cairo", "Kairo", "EG", 30.044, 31.236), T("Khartoum", "Kartum", "SD", 15.501, 32.56),
  T("Addis Ababa", "Adis Abeba", "ET", 9.03, 38.74), T("Nairobi", "Najrobi", "KE", -1.292, 36.822),
  T("Kampala", "Kampala", "UG", 0.347, 32.582), T("Dar es Salaam", "Dar es Salam", "TZ", -6.792, 39.208),
  T("Lagos", "Lagos", "NG", 6.524, 3.379), T("Abuja", "Abudža", "NG", 9.076, 7.399),
  T("Accra", "Akra", "GH", 5.603, -0.187), T("Dakar", "Dakar", "SN", 14.716, -17.467),
  T("Abidjan", "Abidžan", "CI", 5.36, -4.008), T("Lomé", "Lome", "TG", 6.131, 1.223),
  T("Kinshasa", "Kinšasa", "CD", -4.441, 15.266), T("Johannesburg", "Johanesburg", "ZA", -26.204, 28.047),
  T("Cape Town", "Kejptaun", "ZA", -33.925, 18.424), T("Harare", "Harare", "ZW", -17.825, 31.033),
  T("Maputo", "Maputo", "MZ", -25.969, 32.573), T("Antananarivo", "Antananarivo", "MG", -18.88, 47.508),
  T("Tel Aviv", "Tel Aviv", "IL", 32.085, 34.782), T("Ramallah", "Ramala", "PS", 31.903, 35.204),
  T("Beirut", "Bejrut", "LB", 33.894, 35.502), T("Amman", "Aman", "JO", 31.954, 35.911),
  T("Baghdad", "Bagdad", "IQ", 33.315, 44.366), T("Tehran", "Teheran", "IR", 35.689, 51.389),
  // Asia & Pacific
  T("Karachi", "Karači", "PK", 24.861, 67.01), T("Lahore", "Lahore", "PK", 31.549, 74.344),
  T("Islamabad", "Islamabad", "PK", 33.684, 73.048), T("Delhi", "Delhi", "IN", 28.614, 77.209),
  T("Mumbai", "Mumbaj", "IN", 19.076, 72.878), T("Kolkata", "Kolkata", "IN", 22.573, 88.364),
  T("Dhaka", "Daka", "BD", 23.811, 90.413), T("Kathmandu", "Katmandu", "NP", 27.717, 85.324),
  T("Colombo", "Kolombo", "LK", 6.927, 79.861), T("Yangon", "Jangon", "MM", 16.866, 96.195),
  T("Bangkok", "Bangkok", "TH", 13.756, 100.502), T("Phnom Penh", "Pnom Pen", "KH", 11.556, 104.928),
  T("Kuala Lumpur", "Kuala Lumpur", "MY", 3.139, 101.687), T("Jakarta", "Džakarta", "ID", -6.208, 106.846),
  T("Yogyakarta", "Džogdžakarta", "ID", -7.796, 110.369), T("Manila", "Manila", "PH", 14.6, 120.984),
  T("Hong Kong", "Hongkong", "HK", 22.32, 114.17), T("Taipei", "Tajpej", "TW", 25.033, 121.565),
  T("Seoul", "Seul", "KR", 37.567, 126.978), T("Tokyo", "Tokio", "JP", 35.676, 139.65),
  T("Ulaanbaatar", "Ulan Bator", "MN", 47.886, 106.906), T("Almaty", "Almati", "KZ", 43.238, 76.946),
  T("Sydney", "Sidnej", "AU", -33.869, 151.209), T("Melbourne", "Melburn", "AU", -37.814, 144.963),
  T("Auckland", "Okland", "NZ", -36.849, 174.763),
];

const CITY_BY_KEY = new Map(CITIES.map((c) => [c.key, c]));

export function city(key: string | null | undefined): City | undefined {
  return key ? CITY_BY_KEY.get(key) : undefined;
}

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
}

/** Find a known city mentioned in free text (titles, captions). Longest names first so "Novi Sad" beats "Sad". */
const CITY_PATTERNS = [...CITIES]
  .flatMap((c) => [...new Set([c.en, c.sr])].map((name) => ({ c, name: fold(name) })))
  .filter((x) => x.name.length >= 4)
  .sort((a, b) => b.name.length - a.name.length);

export function findCity(text: string): City | undefined {
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  for (const { c, name } of CITY_PATTERNS) {
    // Serbian case endings: Beograd-u, Novom Sadu is not matched, Nišu / Kragujevcu partly.
    const re = new RegExp(` ${name.replace(/ /g, " ")}(?:u|a|e|om)? `);
    if (re.test(t)) return c;
  }
  return undefined;
}

/** City nearest to a point (used client-side to pre-select "your city"; coordinates never leave the device). */
export function nearestCity(lat: number, lon: number): City {
  let best = CITIES[0];
  let bestD = Infinity;
  for (const c of CITIES) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function placeName(c: City, lang: "en" | "sr"): string {
  return lang === "en" ? c.en : c.sr;
}
