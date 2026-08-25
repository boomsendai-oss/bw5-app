-- kioskバリエーションのカラー/サイズ分離 (2026-08-25)
-- iPad UIでカラー行+サイズプルダウンにするため、label(表示用合成)に加えて
-- color/size を分けて持つ。既存行は label 'カラー サイズ' から分割してバックフィルする。

ALTER TABLE kiosk_product_variants ADD COLUMN color TEXT NOT NULL DEFAULT '';

ALTER TABLE kiosk_product_variants ADD COLUMN size TEXT NOT NULL DEFAULT '';

UPDATE kiosk_product_variants
SET color = substr(label, 1, instr(label, ' ') - 1),
    size = substr(label, instr(label, ' ') + 1)
WHERE instr(label, ' ') > 0 AND color = '' AND size = '';

UPDATE kiosk_product_variants
SET size = label
WHERE instr(label, ' ') = 0 AND size = '';
