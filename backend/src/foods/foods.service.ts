import { BadRequestException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { FETCH, FetchFn } from '../common/fetch';
import { REPOSITORY, Repository } from '../storage/repository';

export interface BarcodeProduct {
  barcode: string;
  name: string;
  name_ar: string | null;
  brand: string | null;
  servingG: number | null;
  servingLabel: string | null;
  per100: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number; sodium_mg: number };
  imageUrl: string | null;
  source: 'openfoodfacts';
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Packaged foods by barcode from Open Food Facts (free, open database). Cached for 30 days. */
@Injectable()
export class FoodsService {
  private readonly fetchFn: FetchFn;
  constructor(
    @Inject(REPOSITORY) private readonly repo: Repository,
    @Optional() @Inject(FETCH) fetchFn?: FetchFn,
  ) {
    this.fetchFn = fetchFn ?? fetch;
  }

  async byBarcode(raw: string): Promise<BarcodeProduct> {
    const code = String(raw ?? '').replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) throw new BadRequestException('باركود غير صالح');
    const key = `barcode:${code}`;
    const hit = await this.repo.getCache('*', key);
    if (hit && Date.now() - Date.parse(hit.createdAt) < 30 * 86400000) return hit.payload as BarcodeProduct;

    const fields = 'code,product_name,product_name_ar,product_name_en,brands,serving_size,serving_quantity,nutriments,image_front_small_url';
    const res = await this.fetchFn(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${fields}`, {
      headers: { 'User-Agent': 'StrainEat/1.0 (personal nutrition tracker; contact via app owner)' },
    }).catch(() => null);
    if (!res) throw new ServiceUnavailableException('تعذّر الوصول إلى قاعدة المنتجات');
    if (res.status === 404) throw new NotFoundException('المنتج غير موجود في قاعدة Open Food Facts');
    if (!res.ok) throw new ServiceUnavailableException(`Open Food Facts ${res.status}`);
    const data: any = await res.json();
    if (data.status === 0 || !data.product) throw new NotFoundException('المنتج غير موجود في قاعدة Open Food Facts');
    const p = data.product;
    const n = p.nutriments ?? {};
    const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? Number(n['energy_100g']) / 4.184 : null);
    if (kcal == null) throw new NotFoundException('لا توجد قيم غذائية مسجّلة لهذا المنتج');
    const product: BarcodeProduct = {
      barcode: code,
      name: p.product_name_en || p.product_name || `Product ${code}`,
      name_ar: p.product_name_ar || null,
      brand: p.brands ? String(p.brands).split(',')[0].trim() : null,
      servingG: num(p.serving_quantity) || null,
      servingLabel: p.serving_size || null,
      per100: {
        calories: Math.round(num(kcal)),
        protein_g: num(n.proteins_100g),
        carbs_g: num(n.carbohydrates_100g),
        fat_g: num(n.fat_100g),
        fiber_g: num(n.fiber_100g),
        sugar_g: num(n.sugars_100g),
        // OFF stores sodium in g/100g (or salt; sodium ≈ salt / 2.5)
        sodium_mg: Math.round((n.sodium_100g != null ? num(n.sodium_100g) : num(n.salt_100g) / 2.5) * 1000),
      },
      imageUrl: p.image_front_small_url || null,
      source: 'openfoodfacts',
    };
    await this.repo.setCache({ userId: '*', key, payload: product, createdAt: new Date().toISOString() });
    return product;
  }
}
