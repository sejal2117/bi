#!/usr/bin/env python3
import sys, json, random, datetime

def infer_type(f):
    name = f['name'].lower()
    tags = " ".join(f.get('tags', [])).lower()
    if '$date' in tags or 'date' in name or 'year' in name:
        return 'date'
    if '$numeric' in tags or '$integer' in tags:
        return 'number'
    return 'text'

def synth_value(ftype, name):
    n = name.lower()
    if ftype == 'date':
        # random date in last 2 years
        start = datetime.date.today() - datetime.timedelta(days=730)
        d = start + datetime.timedelta(days=random.randint(0, 730))
        return d.isoformat()
    if ftype == 'number':
        # price/amount style
        if 'price' in n or 'amount' in n or 'revenue' in n or 'sale' in n or 'value' in n:
            return round(random.uniform(10, 2000), 2)
        # quantity / units
        if 'qty' in n or 'units' in n or 'count' in n:
            return random.randint(1, 5000)
        return round(random.uniform(0, 1000), 2)
    # text
    if 'region' in n:
        return random.choice(['North America','Europe','Asia','South America','Africa','Oceania'])
    if 'country' in n:
        return random.choice(['USA','Canada','UK','Germany','France','India','Japan','Brazil','Australia','South Africa'])
    if 'product' in n or 'name' in n:
        return random.choice(['Product A','Product B','Product C','Product D','Product E','Product F','Product G','Product H','Product I','Product J'])
    if 'category' in n:
        return random.choice(['Online','Retail','Wholesale','Direct Sales'])
    return f'{name}_' + str(random.randint(1000, 9999))

def generate(schema, rows_per_table=250):
    out = {}
    for t in schema.get('tables', []):
        tname = t['name']
        fields = t['fields']
        typed = [(f['name'], infer_type(f)) for f in fields]
        rows = []
        for _ in range(rows_per_table):
            row = {}
            for fname, ftype in typed:
                row[fname] = synth_value(ftype, fname)
            rows.append(row)
        out[tname] = rows
    return out

def main():
    payload = json.loads(sys.stdin.read())
    schema = payload['schema']
    rows_per_table = int(payload.get('rowsPerTable', 250))
    data = generate(schema, rows_per_table)
    print(json.dumps({"data": data}, separators=(',',':')))

if __name__ == '__main__':
    main()