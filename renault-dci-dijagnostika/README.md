# Dizel Doktor — dijagnostika za Renault Mégane II 1.5 dCi

Aplikacija za proveru auta preko OBD adaptera, na srpskom, sa glasom i AI agentom.
Pravljena za Renault Mégane II 1.5 dCi (motor K9K, 2002–2006).

**Otvori na telefonu:** https://ilicvix02.github.io/Claude/renault-dci-dijagnostika/app/

## Instalacija na telefon (Android)

1. Otvori adresu iznad u **Chrome-u**.
2. Meni **⋮** → **„Instaliraj aplikaciju“** (ili „Dodaj na početni ekran“).
3. Pojavi se ikonica **Dizel Doktor** — radi i bez interneta (osim AI dela).

iPhone: aplikacija se otvara, ali Safari ne dozvoljava Bluetooth ni USB, pa nema povezivanja sa autom.

## Šta treba

- **OBD adapter** koji podržava K-liniju i CAN:
  - **OBDLink CX** (Bluetooth LE) — preporuka
  - **vLinker FS** (USB, najstabilniji) + OTG adapter za telefon
  - OBDLink EX / SX
  - Jeftini „ELM327 v1.5 / v2.1“ klonovi često ne rade.
- **Za AI (nije obavezno):** sopstveni Anthropic API ključ, unosi se u *Više → Podešavanja* i čuva se samo na tom telefonu. Bez ključa rade: očitavanje grešaka, Renault šifre, vrednosti uživo, automatska provera po fabričkim vrednostima, izveštaj.

## Upotreba

1. Adapter u OBD utičnicu (ispod volana, levo), kontakt uključen.
2. **Poveži auto** → Bluetooth ili USB.
3. (Nije obavezno) šta kaže mušterija — dodirni ili izgovori 🎤.
4. **POKRENI PROVERU** — rezultat se čita naglas.

Bez auta: **„Probaj na primer autu“** — izmišljen auto za vežbu, ništa se ne čuva.

## Bezbednost

Aplikacija samo čita podatke. Jedino što može da pošalje autu je brisanje grešaka, i to tek posle potvrde. Rezultati su procena — konačnu reč daje majstor.

## Za programere

- `index.html` — izvor (isti fajl se objavljuje i kao Claude artifact)
- `build.py` — pravi samostalnu verziju u `app/` (manifest, offline keš, ikonice)
- Posle izmene `index.html` pokreni `python3 renault-dci-dijagnostika/build.py`
