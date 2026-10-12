"""German and Serbian keyword rules for the rule-based classifier.

Non-English text is matched after normalisation: Serbian Cyrillic is transliterated to Latin and
diacritics are folded (č→c, đ→dj, ü→u, ß→ss), so one Latin list covers Cyrillic and Latin Serbian
and spelling variants. Keywords here match case-insensitively. A trailing ``*`` marks a stem
("rat*" matches "rata", "ratu"); a leading ``*`` as well matches inside words, which German
compounds need ("*angriff*" matches "Raketenangriff").
"""

from __future__ import annotations

import re
import unicodedata

LANGS = ("en", "de", "sr")

_CYR = dict(zip(
    "абвгдђежзијклљмнњопрстћуфхцчџшАБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ",
    ["a", "b", "v", "g", "d", "dj", "e", "z", "z", "i", "j", "k", "l", "lj", "m", "n", "nj", "o", "p", "r", "s", "t",
     "c", "u", "f", "h", "c", "c", "dz", "s",
     "A", "B", "V", "G", "D", "Dj", "E", "Z", "Z", "I", "J", "K", "L", "Lj", "M", "N", "Nj", "O", "P", "R", "S", "T",
     "C", "U", "F", "H", "C", "C", "Dz", "S"],
))
_SPECIAL = {"\u00ad": "", "đ": "dj", "Đ": "Dj", "ß": "ss", "ä": "a", "ö": "o", "ü": "u", "Ä": "A", "Ö": "O", "Ü": "U"}


def normalize(text: str) -> str:
    """Cyrillic to Latin, then strip diacritics. Case is kept (proper-noun rules rely on it)."""
    text = "".join(_CYR.get(c) or (_SPECIAL[c] if c in _SPECIAL else c) for c in text or "")
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def compile_words(words: list[str]) -> re.Pattern | None:
    parts = []
    for w in words:
        w = normalize(w)
        infix, stem = w.startswith("*"), w.endswith("*")
        body = re.escape(w.strip("*")).replace(r"\ ", r"\s+")
        parts.append(("" if infix else r"\b") + body + (r"\w*" if stem else r"\b"))
    return re.compile("|".join(parts), re.IGNORECASE) if parts else None


CATEGORIES: dict[str, dict[str, list[str]]] = {
    "de": {
        "deals": ["abkommen*", "vereinbarung*", "vertrag", "vertrage*", "*vertrag", "einigung*", "einig*", "ubernahme*",
                  "fusion*", "investition*", "investier*", "waffenruhe", "waffenstillstand*", "friedensplan*",
                  "friedensgesprach*", "*abkommen*", "handelsdeal*", "deal", "zoll-deal*", "partnerschaft*", "kredit*",
                  "unterzeichn*", "zusage*", "milliardenpaket*"],
        "crises": ["krise*", "*krise*", "notstand*", "krieg*", "*krieg*", "angriff*", "*angriff*", "anschlag*", "*anschlag*",
                   "getotet*", "tote", "toten", "todesopfer*", "opfer", "massaker*", "bombe*", "*bomb*", "luftangriff*",
                   "rakete*", "*rakete*", "beschuss", "invasion", "erdbeben*", "uberschwemmung*", "hochwasser*",
                   "flut*", "wirbelsturm*", "hurrikan*", "taifun*", "tsunami*", "waldbrand*", "*brande", "durre*",
                   "hungersnot*", "ausbruch*", "epidemie*", "pandemie*", "cholera", "ebola", "fluchtling*", "*fluchtling*",
                   "vertrieb*", "evakuier*", "humanitar*", "putsch*", "unruhen", "zusammenbruch*", "rezession*",
                   "geisel*", "terror*", "gewalt*", "vulkan*", "erdrutsch*", "stromausfall*", "eskalation*"],
        "conflict": ["krieg*", "*krieg*", "militar*", "truppe*", "armee*", "bundeswehr", "luftangriff*", "rakete*", "*rakete*",
                     "drohne*", "*drohne*", "rebell*", "milizen", "miliz*", "offensive*", "invasion", "waffenruhe",
                     "waffenstillstand*", "nato", "hamas", "hisbollah", "terror*", "soldat*", "front", "frontlinie*",
                     "waffe*", "*waffen*", "atom*", "nuklear*", "gefecht*", "kampfe*", "kampf*", "bewaffnet*", "beschuss"],
        "disasters": ["erdbeben*", "uberschwemmung*", "hochwasser*", "flut*", "wirbelsturm*", "hurrikan*", "taifun*",
                      "tsunami*", "waldbrand*", "durre*", "vulkan*", "erdrutsch*", "sturm", "sturme*", "unwetter*",
                      "hitzewelle*", "tornado*", "ausbruch des vulkans"],
        "humanitarian": ["humanitar*", "hilfe", "hilfsgut*", "hilfsorganisation*", "fluchtling*", "*fluchtling*", "vertrieb*",
                         "hungersnot*", "hunger", "unterernahr*", "unhcr", "unicef", "wfp", "rotes kreuz", "roten kreuz",
                         "asyl*", "migrant*", "migration", "menschenrecht*"],
        "economy": ["wirtschaft*", "*wirtschaft*", "konjunktur*", "borse*", "aktie*", "inflation", "zins*", "leitzins*",
                    "notenbank*", "zentralbank*", "ezb", "fed", "bip", "handel*", "zoll", "zolle*", "*zolle", "export*",
                    "import*", "olpreis*", "opec", "bank", "banken", "anleger*", "gewinne", "gewinns", "gewinnwarnung*", "umsatz*", "schulden*",
                    "haushalt*", "anleihe*", "wahrung*", "dollar", "euro", "arbeitsmarkt*", "arbeitslos*", "iwf",
                    "weltbank", "steuer*", "*steuer", "strompreis*", "rente*"],
        "diplomacy": ["gipfel*", "*gipfel", "gesprache*", "verhandlung*", "verhandel*", "diplomat*", "minister*",
                      "*minister*", "prasident*", "kanzler*", "sanktion*", "botschaft*", "gesandte*", "sicherheitsrat*",
                      "vereinte nationen", "vereinten nationen", "uno", "g7", "g20", "brics", "aussenpolitik*", "bilateral*",
                      "wahl", "wahlen", "*wahl", "wahlkampf*", "parlament*", "bundestag", "koalition*", "regierung*"],
        "climate": ["klima*", "*klima*", "emission*", "co2", "kohlendioxid", "netto-null", "klimaneutral*",
                    "erneuerbare*", "solar*", "windkraft*", "fossil*", "kohle*", "erderwarmung", "hitzewelle*", "abholzung",
                    "artenvielfalt", "energie*", "*energie*", "lng", "pipeline*", "gas", "strom*"],
        "health": ["gesundheit*", "*gesundheit*", "who", "weltgesundheitsorganisation", "virus", "*virus", "impf*",
                   "krankheit*", "*krankheit*", "cholera", "ebola", "mpox", "masern", "malaria", "pandemie*", "epidemie*",
                   "krankenhaus*", "*klinik*", "patient*", "medizin*", "arzt", "arzte*", "pflege*"],
        "tech": ["kunstliche intelligenz", "ki", "chip*", "halbleiter*", "cyber*", "hacker*", "*hacker*", "tech*",
                 "software", "rechenzentr*", "satellit*", "raumfahrt*", "digital*"],
    },
    "sr": {
        "deals": ["sporazum*", "dogovor*", "ugovor*", "akord*", "pakt*", "spajanj*", "preuzimanj*", "partnerstv*",
                  "memorandum*", "potpis*", "investicij*", "ulaganj*", "ulaz*", "primirj*", "prekid vatre", "mirovn* pregovor*",
                  "mirovn* plan*", "slobodn* trgovin*", "kredit*", "zajam", "zajm*", "finansiranj*", "obavez*", "nagodb*",
                  "donacij*"],
        "crises": ["kriz*", "vanredn*", "rat", "rata", "ratu", "ratom", "ratn*", "napad*", "ubijen*", "ubijeno", "ubio",
                   "poginul*", "poginu*", "mrtv*", "zrtv*", "masakr*", "bomb*", "vazdusn* napad*", "raket*", "granatiranj*",
                   "invazij*", "zemljotres*", "potres*", "poplav*", "ciklon*", "uragan*", "tajfun*", "cunami*", "pozar*",
                   "susa", "suse", "susom", "glad", "gladi", "epidemij*", "pandemij*", "kolera", "kolere", "ebol*",
                   "izbeglic*", "izbjeglic*", "raseljen*", "evakuis*", "evakuacij*", "humanitarn*", "puc", "pucist*",
                   "neredi", "nemir*", "kolaps*", "recesij*", "talac*", "taoc*", "teror*", "nasilj*", "vulkan*",
                   "klizist*", "nestasic*", "nestanak struje", "eskalacij*"],
        "conflict": ["rat", "rata", "ratu", "ratom", "ratn*", "vojsk*", "vojn*", "trupe", "trupa", "armij*", "vazdusn* napad*",
                     "raket*", "dron*", "pobunjen*", "militant*", "milicij*", "ofanziv*", "invazij*", "primirj*", "nato",
                     "hamas*", "hezbolah*", "teror*", "vojnik*", "vojnic*", "front", "frontu", "fronta", "linij* fronta",
                     "oruzj*", "naoruz*", "nuklearn*", "atomsk*", "borb*", "sukob*", "okrsaj*", "naoruzan*", "granatiranj*"],
        "disasters": ["zemljotres*", "potres*", "poplav*", "ciklon*", "uragan*", "tajfun*", "cunami*", "pozar*", "susa",
                      "suse", "vulkan*", "klizist*", "oluj*", "nevrem*", "toplotn* talas*", "tornad*", "erupcij*"],
        "humanitarian": ["humanitarn*", "pomoc", "pomoci", "izbeglic*", "izbjeglic*", "raseljen*", "glad", "gladi",
                         "pothranjen*", "unhcr", "unicef", "crven* krst*", "azil*", "migrant*", "ljudsk* prav*"],
        "economy": ["ekonomij*", "ekonomsk*", "privred*", "trzist*", "berz*", "akcij*", "inflacij*", "kamat*",
                    "centraln* bank*", "nbs", "narodn* bank*", "ecb", "fed", "bdp", "trgovin*", "carin*", "izvoz*", "uvoz*",
                    "cen* nafte", "nafta", "opec", "bank*", "investitor*", "profit*", "dobit*", "prihod*", "dug", "duga",
                    "dugov*", "obveznic*", "valut*", "dolar*", "evra", "evro", "evrima", "evrozon*", "dinar*", "plat*", "penzij*", "nezaposlen*",
                    "mmf", "svetsk* bank*", "budzet*", "porez*", "devizn* rezerv*"],
        "diplomacy": ["samit*", "pregovor*", "razgovor*", "diplomat*", "ministar*", "ministr*", "predsednik*",
                      "predsjednik*", "premijer*", "sankcij*", "ambasad*", "izaslanik*", "savet* bezbednosti",
                      "ujedinjen* nacij*", "un", "ujedinjenih nacija", "g7", "g20", "brics", "spoljn* politik*",
                      "bilateraln*", "izbor*", "izborn*", "glasanj*", "glasac*", "biraci", "biraca", "skupstin*", "parlament*",
                      "vlad*", "koalicij*"],
        "climate": ["klim*", "emisij*", "ugljen*", "obnovljiv*", "solarn*", "vetroelektran*", "fosiln*", "ugalj", "uglja",
                    "globaln* zagrevanj*", "toplotn* talas*", "sec* sum*", "biodiverzitet*", "energ*", "lng", "gasovod*",
                    "naftovod*", "gas", "gasa", "struj*", "elektroprivred*"],
        "health": ["zdravlj*", "zdravstv*", "szo", "who", "svetsk* zdravstven* organizacij*", "virus*", "vakcin*",
                   "bolest*", "oboljen*", "kolera", "ebol*", "mpox", "male boginj*", "malarij*", "pandemij*", "epidemij*",
                   "bolnic*", "pacijent*", "lekar*", "ljekar*", "medicin*", "groznic*", "batut"],
        "tech": ["vestacka inteligencij*", "vestack* inteligencij*", "ai", "cip*", "poluprovodnik*", "sajber*", "hak*",
                 "tehnolog*", "softver*", "data centr*", "satelit*", "svemir*", "digitaln*"],
    },
}

# Local place and people names per region, added to the English names (which mostly match too).
REGIONS: dict[str, dict[str, list[str]]] = {
    "de": {
        "africa": ["Afrika*", "afrikanisch*", "Agypten", "agyptisch*", "Athiopien", "athiopisch*", "Kenia", "Nigeria",
                   "Sudan", "Sudsudan", "Somalia", "Kongo", "Libyen", "Marokko", "Tunesien", "Algerien", "Mosambik",
                   "Sudafrika", "Tansania", "Kamerun", "Tschad", "Elfenbeinkuste", "Sahel"],
        "asia": ["Asien", "asiatisch*", "Afghanistan", "Taliban", "China", "chinesisch*", "Peking", "Indien", "indisch*",
                 "Indonesien", "Japan", "japanisch*", "Nordkorea", "Sudkorea", "Korea", "Pakistan", "Philippinen",
                 "Singapur", "Taiwan", "Thailand", "Vietnam", "Myanmar", "Kambodscha", "Kasachstan", "Mongolei"],
        "europe": ["Europa", "europaisch*", "EU", "Brussel", "Deutschland", "deutsch*", "Berlin", "Bundesregierung",
                   "Bundestag", "Osterreich*", "osterreichisch*", "Wien", "Schweiz*", "schweizer*", "Bern", "Frankreich",
                   "franzosisch*", "Italien*", "Spanien", "Grossbritannien", "britisch*", "Polen", "polnisch*",
                   "Ungarn", "Tschechien", "Griechenland", "Turkei", "Russland", "russisch*", "Moskau", "Ukraine",
                   "ukrainisch*", "Kiew", "Serbien", "serbisch*", "Belgrad", "Kroatien", "Bosnien", "Kosovo",
                   "Rumanien", "Bulgarien", "Niederlande", "Belgien", "Danemark", "Schweden", "Norwegen", "Finnland",
                   "Weissrussland", "Belarus", "Moldau", "Georgien", "Armenien", "Aserbaidschan", "Merz", "Putin",
                   "Selenskyj", "Kreml"],
        "middle-east": ["Nahost", "Nahen Osten", "Mittlerer Osten", "Iran", "iranisch*", "Teheran", "Irak", "irakisch*",
                        "Israel", "israelisch*", "Gaza*", "Westjordanland", "Palastin*", "Hamas", "Hisbollah",
                        "Jordanien", "Libanon", "libanesisch*", "Beirut", "Katar", "Saudi-Arabien", "saudisch*",
                        "Syrien", "syrisch*", "Damaskus", "Turkei", "turkisch*", "Ankara", "Jemen", "Huthi*", "Rotes Meer",
                        "Roten Meer", "Emirate", "Netanjahu"],
        "americas": ["USA", "US-*", "Vereinigte Staaten", "amerikanisch*", "Washington", "Weisses Haus", "Weissen Haus",
                     "Trump", "Kongress", "Pentagon", "Kanada", "kanadisch*", "Mexiko", "Argentinien", "Brasilien",
                     "Chile", "Kolumbien", "Kuba", "Ecuador", "Haiti", "Peru", "Venezuela", "Lateinamerika", "Karibik"],
        "oceania": ["Australien", "australisch*", "Neuseeland", "Fidschi", "Papua-Neuguinea", "Pazifikinseln"],
    },
    "sr": {
        "africa": ["Afrik*", "africk*", "Egipat", "Egipt*", "Etiopij*", "Kenij*", "Nigerij*", "Sudan*", "Juzn* Sudan*",
                   "Somalij*", "Kong*", "Libij*", "Marok*", "Tunis*", "Alzir*", "Mozambik*", "Juzn* Afrik*", "Sahel*"],
        "asia": ["Azij*", "azijsk*", "Avganistan*", "Afganistan*", "talib*", "Kina", "Kine", "Kini", "Kinom", "kinesk*", "Peking*", "Indij*",
                 "indijsk*", "Indonezij*", "Japan*", "Severn* Kore*", "Juzn* Kore*", "Kore*", "Pakistan*", "Filipin*",
                 "Singapur*", "Tajvan*", "Tajland*", "Vijetnam*", "Mjanmar*", "Kazahstan*"],
        "europe": ["Evrop*", "Europ*", "evropsk*", "EU", "Brisel*", "Nemack*", "nemack*", "Njemack*", "Berlin*",
                   "Austrij*", "Bec", "Beca", "Becu", "Svajcarsk*", "Francusk*", "Pariz*", "Itali*", "Rim", "Spanij*", "Britanij*",
                   "britansk*", "London*", "Poljsk*", "Madjarsk*", "Ceska", "Ceske", "Grck*", "Rusij*", "rusk*",
                   "Moskv*", "Kremlj*", "Putin*", "Ukrajin*", "ukrajinsk*", "Kijev*", "Zelensk*", "Srbij*", "srpsk*",
                   "Beograd*", "Novi Sad", "Novom Sadu", "Vucic*", "Hrvatsk*", "Zagreb*", "Bosn*",
                   "BiH", "Sarajev*", "Republik* Srpsk*", "Banj* Luk*", "Crn* Gor*", "Podgoric*", "Kosov*", "Pristin*",
                   "Severn* Makedonij*", "Makedonij*", "Skopj*", "Slovenij*", "Albanij*", "Rumunij*", "Bugarsk*",
                   "Holandij*", "Belgij*", "Dansk*", "Svedsk*", "Norvesk*", "Finsk*", "Belorusij*", "Moldavij*",
                   "Gruzij*", "Jermenij*", "Azerbejdzan*", "Balkan*"],
        "middle-east": ["Blisk* istok*", "Bliskom istoku", "Iran*", "iransk*", "Teheran*", "Irak*", "Bagdad*", "Izrael*",
                        "izraelsk*", "Jerusalim*", "Netanijah*", "Gaza", "Gaze", "Gazi", "Gazom", "Zapadn* obal*", "Palestin*", "palestinsk*",
                        "Hamas*", "Hezbolah*", "Jordan*", "Liban*", "Bejrut*", "Katar*", "Saudijsk* Arabij*", "Sirij*",
                        "sirijsk*", "Damask*", "Turs*", "Ankar*", "Erdogan*", "Emirat*", "Jemen*", "Husi", "Husij*",
                        "Crven* mor*"],
        "americas": ["SAD", "Americk*", "americk*", "Amerik*", "Vasington*", "Bel* kuc*", "Tramp*", "Kongres*",
                     "Pentagon*", "Kanad*", "Meksik*", "Argentin*", "Brazil*", "Cile", "Kolumbij*", "Kuba", "Kube", "Kubi", "Haiti",
                     "Venecuel*", "Latinsk* Amerik*", "Karib*"],
        "oceania": ["Australij*", "australijsk*", "Novi Zeland", "Novog Zelanda", "Fidzi"],
    },
}

SIGNALS: dict[str, dict[str, list[str]]] = {
    "de": {
        "escalation": ["angriff*", "*angriff*", "luftangriff*", "beschuss", "beschoss*", "offensive*", "rakete*",
                       "*rakete*", "drohne*", "*drohne*", "bombard*", "getotet*", "tote", "toten", "massaker*",
                       "invasion", "gefecht*", "kampfe", "vorstoss*", "erobert*", "eskal*", "explosion*", "anschlag*"],
        "de-escalation": ["waffenruhe", "waffenstillstand*", "friedensabkommen*", "friedensgesprach*", "friedensplan*",
                          "gefangenenaustausch*", "freilassung*", "freigelassen*", "abzug*", "deeskal*"],
        "humanitarian": ["humanitar*", "hilfe", "hilfsgut*", "hungersnot*", "hunger", "vertrieb*", "fluchtling*",
                         "zivilist*", "evakuier*"],
        "diplomatic": ["gesprache*", "gipfel*", "verhandl*", "sanktion*", "diplomat*", "vermittl*", "sicherheitsrat*",
                       "minister*", "*minister*"],
    },
    "sr": {
        "escalation": ["napad*", "vazdusn* napad*", "granatiranj*", "granatir*", "ofanziv*", "raket*", "dron*", "bombard*",
                       "ubijen*", "ubijeno", "poginul*", "masakr*", "invazij*", "borb*", "sukob*", "napredovanj*",
                       "zauzel*", "zauzet*", "eskal*", "eksplozij*"],
        "de-escalation": ["primirj*", "prekid vatre", "mirovn* sporazum*", "mirovn* pregovor*", "mirovn* plan*",
                          "razmen* zarobljenik*", "oslobodjen* talac*", "povlacenj*", "deeskal*"],
        "humanitarian": ["humanitarn*", "pomoc", "glad", "gladi", "raseljen*", "izbeglic*", "civil*", "evakuis*"],
        "diplomatic": ["pregovor*", "razgovor*", "samit*", "sankcij*", "diplomat*", "posredovanj*", "savet* bezbednosti",
                       "ministar*"],
    },
}

CASUALTY = {
    "de": ["getotet*", "tote", "toten", "todesopfer*", "massaker*", "verletzt*", "verwundet*", "opfer"],
    "sr": ["ubijen*", "ubijeno", "poginul*", "poginu*", "mrtv*", "zrtv*", "masakr*", "ranjen*", "povredjen*"],
}
SCALE = {
    "de": ["dutzende", "hunderte", "tausende", "massen*"],
    "sr": ["desetin*", "stotin*", "hiljad*", "masovn*"],
}

EXCLUDE = {
    "de": ["fussball*", "bundesliga", "champions league", "tennis", "formel 1", "formel-1", "olympi*", "wm-*", "em-*",
           "horoskop*", "rezept*", "promi*", "tor des", "torwart*", "trainer", "tatort"],
    "sr": ["fudbal*", "kosark*", "tenis*", "vaterpol*", "odbojk*", "rukomet*", "superlig*", "liga sampion*",
           "olimpij*", "horoskop*", "recept*", "estrad*", "rijaliti*", "zvezd*", "partizan*", "golman*", "trener*",
           "utakmic*", "mundijal*", "evrolig*", "sport*", "*tenis*", "gol", "golom", "kup"],
}

_COMPILED: dict[tuple, re.Pattern | None] = {}


def pattern(table: str, lang: str, key: str | None = None) -> re.Pattern | None:
    """Compiled local word pattern, e.g. pattern("categories", "de", "crises")."""
    k = (table, lang, key)
    if k not in _COMPILED:
        src = {"categories": CATEGORIES, "regions": REGIONS, "signals": SIGNALS,
               "casualty": CASUALTY, "scale": SCALE, "exclude": EXCLUDE}[table].get(lang) or {}
        words = src.get(key, []) if key is not None else src
        _COMPILED[k] = compile_words(list(words)) if words else None
    return _COMPILED[k]
