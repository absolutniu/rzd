import json, os, re

d = json.load(open('../docs/data/catalog_data.json', encoding='utf-8'))
mfrs = {m['id']: m for m in d['manufacturers']}
kinds = {k['id']: k for k in d['vagonKinds']}
types = {t['id']: t for t in d['vagonTypes']}
vagons = d['vagons']

# manufacturer alias -> exact mfr short_name(s), most specific mapping (no overlap ambiguity)
MFR_ALIASES = {
    'rm rail': ['РМ Рейл'],
    'алтайвагон': ['Алтайвагон'],
    'зск': ['ЗСК Кубань'],
    'зск кубань': ['ЗСК Кубань'],
    'змк': ['ЗМК'],
    'нтр': ['НТР'],
    'новотехрейл': ['НТР'],
    'овк': ['НПК ОВК'],
    'увз': ['НПК УВЗ'],
    'уралвагонзавод': ['НПК УВЗ'],
    'бврз': ['Алтайвагон-БВСЗ'],
    'брвз': ['Алтайвагон-БВСЗ'],
    'врвз': ['Алтайвагон-БВСЗ'],
    'барнаульский врз': ['Алтайвагон-БВСЗ'],
    'каваз': ['КАВАЗ'],
    'тврз': ['ТВСЗ'],
    'твсз': ['ТВСЗ'],
    'рвзр': ['РВРЗ'],
    'рврз': ['РВРЗ'],
    'рврз рославль': ['РВРЗ'],
    'рославль': ['РВРЗ'],
    'рославльский': ['РВРЗ'],
    'синара калугапутьмаш': ['Синара-ТМ'],
    'синара ярославпутьмаш': ['Синара-ТМ'],
    'синара трансмаш': ['Синара-ТМ'],
    'синара': ['Синара-ТМ'],
    'этм': ['Трансмаш'],
    'этм трансмаш': ['Трансмаш'],
    'трансмаш': ['Трансмаш'],
    'стахановский': ['РТ-Новые Горизонты'],
    'рт-новые горизонты': ['РТ-Новые Горизонты'],
    'рт-новые горизонты,': ['РТ-Новые Горизонты'],
}

def norm(s):
    return re.sub(r'\s+', ' ', s.strip().lower())

def norm_model(m):
    m = m.strip().replace('«', '').replace('»', '')
    m = re.sub(r'\s+', ' ', m)
    return m.lower()

def strip_leading_zero(seg):
    m = re.match(r'^0+([0-9].*)$', seg)
    return m.group(1) if m else seg

def dash_key_variants(key):
    """A dash-segmented key, plus a variant with leading zeros stripped from
    each segment (e.g. "15-1210-01п" ~ "15-1210-1п")."""
    segs = key.split('-')
    stripped = '-'.join(strip_leading_zero(s) for s in segs)
    return {key, stripped}

# exact model(+optional trailing note words removed) -> list of vagons
vagon_by_model = {}
for v in vagons:
    key = norm_model(v['model'])
    # also register just the leading token before any space (drop trailing note like "«УРАЛ»")
    base_key = key.split(' ')[0]
    for k0 in {key, base_key}:
        for k in dash_key_variants(k0):
            vagon_by_model.setdefault(k, []).append(v)

def find_vagon_for_model_token(tok, mfr_candidates):
    """Try exact match, then progressively strip trailing -NN suffix segments,
    then (for bare numeric fragments missing the leading type prefix) try
    suffix matching against known keys."""
    tok_norm = norm_model(tok)
    segments = tok_norm.split('-')
    for cut in range(len(segments), 0, -1):
        candidate_key = '-'.join(segments[:cut])
        vlist = vagon_by_model.get(candidate_key)
        if not vlist:
            stripped_key = '-'.join(strip_leading_zero(s) for s in segments[:cut])
            vlist = vagon_by_model.get(stripped_key)
            if vlist:
                candidate_key = stripped_key
        if not vlist:
            continue
        if mfr_candidates:
            filtered = [v for v in vlist if mfrs.get(v['mfrId'], {}).get('short_name') in mfr_candidates]
            if filtered:
                return filtered[0], candidate_key
            if len(vlist) == 1:
                # mfr hint didn't match any known short_name (e.g. a subsidiary
                # plant name), but the model itself is unambiguous in the catalog
                return vlist[0], candidate_key
        elif len(vlist) == 1:
            return vlist[0], candidate_key

    # fallback: bare digits without the leading "NN-" type prefix (e.g. "9950")
    if re.fullmatch(r'[0-9]+[a-zа-я]*', tok_norm) and mfr_candidates:
        suffix = '-' + tok_norm
        candidates = [(k, v) for k, v in vagon_by_model.items() if k.endswith(suffix)]
        filtered = []
        for k, vlist in candidates:
            for v in vlist:
                if mfrs.get(v['mfrId'], {}).get('short_name') in mfr_candidates:
                    filtered.append((k, v))
        if len(filtered) == 1:
            return filtered[0][1], filtered[0][0]
    return None, None

def extract_model_tokens(text):
    text = text.replace('_', '-')
    raw = re.findall(r'[0-9A-ZА-Яa-zа-я]+(?:[-–][0-9A-ZА-Яa-zа-я]+)*', text)
    tokens = [t for t in raw if any(c.isdigit() for c in t)]
    return tokens

photo_dir = '../docs/Photo'
files = sorted(os.listdir(photo_dir))

results = []
unmatched = []

for fn in files:
    base = os.path.splitext(fn)[0]
    parts = base.split(' ', 1)
    category_word = parts[0]
    rest = parts[1] if len(parts) > 1 else ''
    words = rest.split(' ')
    split_i = len(words)
    for i, w in enumerate(words):
        if any(c.isdigit() for c in w):
            split_i = i
            break
    mfr_text = ' '.join(words[:split_i]).strip()
    model_text = ' '.join(words[split_i:]).strip()

    mfr_key = norm(mfr_text)
    candidates_mfr = MFR_ALIASES.get(mfr_key)
    if not candidates_mfr:
        for k, v in MFR_ALIASES.items():
            if k in mfr_key or mfr_key in k:
                candidates_mfr = v
                break

    model_tokens = extract_model_tokens(model_text)
    if not model_tokens:
        model_tokens = [model_text]

    matched_vagon = None
    matched_key = None
    used_tok = None
    for tok in model_tokens:
        v, key = find_vagon_for_model_token(tok, candidates_mfr)
        if v:
            matched_vagon = v
            matched_key = key
            used_tok = tok
            break

    if matched_vagon:
        kind = kinds.get(matched_vagon['kindId'])
        typ = types.get(kind['vagon_type_id']) if kind else None
        mfr = mfrs.get(matched_vagon['mfrId'])
        results.append({
            'file': fn,
            'vagonId': matched_vagon['id'],
            'model': matched_vagon['model'],
            'mfr': mfr['short_name'] if mfr else '',
            'type': typ['name'] if typ else '',
            'kind': kind['name'] if kind else '',
            'matchedOn': matched_key,
            'mfrTextInFile': mfr_text,
        })
    else:
        unmatched.append({'file': fn, 'mfr_text': mfr_text, 'model_text': model_text, 'candidates_mfr': candidates_mfr, 'model_tokens': model_tokens})

with open('photo_match_results.json', 'w', encoding='utf-8') as f:
    json.dump({'matched': results, 'unmatched': unmatched}, f, ensure_ascii=False, indent=2)

print('matched:', len(results))
print('unmatched:', len(unmatched))

# check multiple photos mapping to same vagon (fine) and vagons with >1 distinct photo source file variety
from collections import defaultdict
by_vagon = defaultdict(list)
for r in results:
    by_vagon[r['vagonId']].append(r['file'])
print('distinct vagons matched:', len(by_vagon))
