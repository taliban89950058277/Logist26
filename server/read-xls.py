import json
import sys

import xlrd

workbook = xlrd.open_workbook(sys.argv[1], on_demand=True)
sheet = workbook.sheet_by_index(0)
rows = [[sheet.cell_value(row, column) for column in range(sheet.ncols)] for row in range(sheet.nrows)]
print(json.dumps(rows, ensure_ascii=False))