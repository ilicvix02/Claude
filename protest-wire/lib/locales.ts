// Every UI dictionary, bundled on the server only. The browser receives just the active language.

import type { Dict } from "./i18n.ts";
import { chainFor } from "./i18n.ts";
import L_sr from "../locales/sr.json" with { type: "json" };
import L_sq from "../locales/sq.json" with { type: "json" };
import L_hy from "../locales/hy.json" with { type: "json" };
import L_az from "../locales/az.json" with { type: "json" };
import L_be from "../locales/be.json" with { type: "json" };
import L_bs from "../locales/bs.json" with { type: "json" };
import L_bg from "../locales/bg.json" with { type: "json" };
import L_ca from "../locales/ca.json" with { type: "json" };
import L_hr from "../locales/hr.json" with { type: "json" };
import L_cs from "../locales/cs.json" with { type: "json" };
import L_da from "../locales/da.json" with { type: "json" };
import L_nl from "../locales/nl.json" with { type: "json" };
import L_et from "../locales/et.json" with { type: "json" };
import L_fi from "../locales/fi.json" with { type: "json" };
import L_fr from "../locales/fr.json" with { type: "json" };
import L_ka from "../locales/ka.json" with { type: "json" };
import L_de from "../locales/de.json" with { type: "json" };
import L_el from "../locales/el.json" with { type: "json" };
import L_hu from "../locales/hu.json" with { type: "json" };
import L_is from "../locales/is.json" with { type: "json" };
import L_ga from "../locales/ga.json" with { type: "json" };
import L_it from "../locales/it.json" with { type: "json" };
import L_lv from "../locales/lv.json" with { type: "json" };
import L_lt from "../locales/lt.json" with { type: "json" };
import L_lb from "../locales/lb.json" with { type: "json" };
import L_mk from "../locales/mk.json" with { type: "json" };
import L_mt from "../locales/mt.json" with { type: "json" };
import L_cnr from "../locales/cnr.json" with { type: "json" };
import L_no from "../locales/no.json" with { type: "json" };
import L_pl from "../locales/pl.json" with { type: "json" };
import L_pt from "../locales/pt.json" with { type: "json" };
import L_ro from "../locales/ro.json" with { type: "json" };
import L_ru from "../locales/ru.json" with { type: "json" };
import L_sk from "../locales/sk.json" with { type: "json" };
import L_sl from "../locales/sl.json" with { type: "json" };
import L_es from "../locales/es.json" with { type: "json" };
import L_sv from "../locales/sv.json" with { type: "json" };
import L_tr from "../locales/tr.json" with { type: "json" };
import L_uk from "../locales/uk.json" with { type: "json" };

const DICTS: Record<string, Dict> = {
  "sr": L_sr as Dict,
  "sq": L_sq as Dict,
  "hy": L_hy as Dict,
  "az": L_az as Dict,
  "be": L_be as Dict,
  "bs": L_bs as Dict,
  "bg": L_bg as Dict,
  "ca": L_ca as Dict,
  "hr": L_hr as Dict,
  "cs": L_cs as Dict,
  "da": L_da as Dict,
  "nl": L_nl as Dict,
  "et": L_et as Dict,
  "fi": L_fi as Dict,
  "fr": L_fr as Dict,
  "ka": L_ka as Dict,
  "de": L_de as Dict,
  "el": L_el as Dict,
  "hu": L_hu as Dict,
  "is": L_is as Dict,
  "ga": L_ga as Dict,
  "it": L_it as Dict,
  "lv": L_lv as Dict,
  "lt": L_lt as Dict,
  "lb": L_lb as Dict,
  "mk": L_mk as Dict,
  "mt": L_mt as Dict,
  "cnr": L_cnr as Dict,
  "no": L_no as Dict,
  "pl": L_pl as Dict,
  "pt": L_pt as Dict,
  "ro": L_ro as Dict,
  "ru": L_ru as Dict,
  "sk": L_sk as Dict,
  "sl": L_sl as Dict,
  "es": L_es as Dict,
  "sv": L_sv as Dict,
  "tr": L_tr as Dict,
  "uk": L_uk as Dict,
};

/** Dictionaries for a language, most specific first (English is the built-in default). */
export function dictionaryChain(lang: string): Dict[] {
  return chainFor(lang).map((c) => DICTS[c] ?? {});
}

export function dictionary(code: string): Dict {
  return DICTS[code] ?? {};
}
