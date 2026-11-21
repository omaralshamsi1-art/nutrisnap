import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/**
 * User-facing error messages are written in Arabic in the services; this filter returns the
 * English version unless the client asks for Arabic (Accept-Language: ar…).
 */
const EXACT: Record<string, string> = {
  'بريد إلكتروني غير صالح': 'Invalid email address',
  'اكتب رسالتك': 'Type your message',
  'الرسالة طويلة جداً': 'Message is too long',
  'الإجراء غير موجود': 'Action not found',
  'كلمة المرور يجب أن تكون 8 أحرف على الأقل': 'Password must be at least 8 characters',
  'هذا البريد مسجّل مسبقاً': 'This email is already registered',
  'هذا الحساب مرتبط مسبقاً': 'This account is already linked',
  'رمز الدعوة غير صالح أو منتهي': 'Invite code is invalid or expired',
  'محاولات كثيرة، حاول بعد 15 دقيقة': 'Too many attempts — try again in 15 minutes',
  'البريد أو كلمة المرور غير صحيحة': 'Wrong email or password',
  'باركود غير صالح': 'Invalid barcode',
  'تعذّر الوصول إلى قاعدة المنتجات': "Couldn't reach the product database",
  'المنتج غير موجود في قاعدة Open Food Facts': 'Product not found in Open Food Facts',
  'لا توجد قيم غذائية مسجّلة لهذا المنتج': 'No nutrition values recorded for this product',
  'اكتب وصفاً للوجبة': 'Describe the meal',
  'الوصف طويل جداً': 'Description is too long',
  'الوجبة غير موجودة في المفضلة': 'Meal not found in favourites',
};

const PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^وصلت للحد اليومي لتحليل الصور \((\d+)\)/, (m) => `Daily photo-analysis limit reached (${m[1]}). Try tomorrow or add the meal from favourites.`],
  [/^وصلت للحد اليومي لرسائل المساعد \((\d+)\)/, (m) => `Daily assistant message limit reached (${m[1]}). Try again tomorrow.`],
  [/^وصلت للحد اليومي لطلبات المدرب \((\d+)\)/, (m) => `Daily coach limit reached (${m[1]}).`],
];

export function toEnglish(msg: string): string {
  if (EXACT[msg]) return EXACT[msg];
  for (const [re, f] of PATTERNS) {
    const m = msg.match(re);
    if (m) return f(m);
  }
  return msg;
}

export function wantsArabic(acceptLanguage: unknown): boolean {
  return typeof acceptLanguage === 'string' && /^\s*ar\b/i.test(acceptLanguage);
}

@Catch(HttpException)
export class LocalizedErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const status = exception.getStatus();
    let body = exception.getResponse() as any;
    if (!wantsArabic(req?.headers?.['accept-language'])) {
      if (typeof body === 'string') body = toEnglish(body);
      else if (body && typeof body.message === 'string') body = { ...body, message: toEnglish(body.message) };
      else if (body && Array.isArray(body.message)) body = { ...body, message: body.message.map((m: unknown) => (typeof m === 'string' ? toEnglish(m) : m)) };
    }
    if (typeof body === 'string') body = { statusCode: status, message: body };
    res.status(status).json(body);
  }
}
