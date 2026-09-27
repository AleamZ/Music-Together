# 20 fashion models: the shared contract (art agent and store agent)

Each garment has its own silhouette (not a recolour). The ids, slots, genders and prices below are fixed and shared by both agents.
- The **art agent** draws each id in `lib/game/art/` (front, back and side views, and the walk frames). It exports `GARMENT_ART_IDS`, the list of ids it draws, from `lib/game/art/garments.ts`.
- The **store agent** adds the ids to the catalog and store (DB migration `0024_fashion_models.sql`, `lib/game/store.ts`, `lib/game/character.ts` validation, store UI tags).

The slots are the existing ones (`top`, `bottom`, `shoes`), plus `outfit`: a full-body piece that replaces top and bottom while worn. When an `outfit` is worn, the character's `top` and `bottom` choices are kept but not drawn.

| id | name | slot | gender | price (xu) |
|---|---|---|---|---|
| fm_hoodie | Áo hoodie | top | unisex | 900 |
| fm_denim_jacket | Áo khoác jean | top | unisex | 1200 |
| fm_school_shirt | Sơ mi đồng phục | top | unisex | 600 |
| fm_ao_dai | Áo dài | outfit | nu | 2500 |
| fm_ao_ba_ba | Áo bà ba | top | unisex | 700 |
| fm_sailor_top | Áo cổ thủy thủ | top | unisex | 800 |
| fm_varsity | Áo bomber bóng chày | top | unisex | 1400 |
| fm_cardigan | Áo cardigan | top | unisex | 1000 |
| fm_tank_top | Áo ba lỗ | top | unisex | 400 |
| fm_raincoat | Áo mưa | top | unisex | 900 |
| fm_kimono | Áo kimono | outfit | unisex | 2200 |
| fm_jersey | Áo đá banh | top | unisex | 800 |
| fm_chef_coat | Áo đầu bếp | top | unisex | 1100 |
| fm_suit | Áo vest | top | unisex | 1800 |
| fm_puffer | Áo phao | top | unisex | 1600 |
| fm_pleated_skirt | Váy xếp ly | bottom | nu | 700 |
| fm_maxi_dress | Đầm maxi | outfit | nu | 2000 |
| fm_overalls | Quần yếm | outfit | unisex | 1300 |
| fm_cargo_shorts | Quần short túi hộp | bottom | unisex | 600 |
| fm_rolled_jeans | Quần jean xắn gấu | bottom | unisex | 900 |

Shoes (extra, shape-based): `fm_boots` "Giày bốt" (shoes, unisex, 1000), `fm_sneakers` "Giày sneaker" (shoes, unisex, 800), `fm_sandals` "Dép quai hậu" (shoes, unisex, 300).

A gender-tagged item may be worn only by that gender. The store shows it with a ♂/♀ tag and hides it when the "Hợp với tôi" filter is on.
