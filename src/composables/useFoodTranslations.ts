import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

type FoodLocale = { food?: { items?: Record<string, string> } }

const FOOD_LOCALE_MESSAGES: FoodLocale[] = [zhTW, zhCN, en, ja, ko] as FoodLocale[]

function normalizeFoodSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_]+/g, '')
}

function getFoodSearchTerms(foodName: string, currentTranslation: string): string[] {
  const terms = new Set<string>([foodName, currentTranslation])

  for (const locale of FOOD_LOCALE_MESSAGES) {
    const item = locale.food?.items?.[foodName]
    if (typeof item === 'string' && item.trim()) {
      terms.add(item)
    }
  }

  return [...terms]
}

export function matchesFoodSearch(foodName: string, query: string, currentTranslation: string): boolean {
  const needle = normalizeFoodSearchText(query)
  if (!needle) return true

  return getFoodSearchTerms(foodName, currentTranslation)
    .some(term => normalizeFoodSearchText(term).includes(needle))
}

/**
 * 食物翻譯 composable
 * 統一使用 vue-i18n 系統，從 src/i18n/locales/ 讀取翻譯
 */
export function useFoodTranslations() {
  const { t } = useI18n()

  // 不再需要手動載入，vue-i18n 會自動處理
  const loadTranslations = async () => {
    // 保持接口相容性，但實際上什麼都不做
    return Promise.resolve()
  }

  // 翻譯函數，支持嵌套的 key
  const tFood = (key: string): string => {
    return t(`food.${key}`)
  }

  // 翻譯食物名稱
  const translateFood = (foodName: string): string => {
    return t(`food.items.${foodName}`, foodName) // 如果找不到翻譯，返回原名稱
  }

  // 偏好標籤
  const preferenceLabels = computed(() => ({
    veryLike: t('food.preferences.veryLike'),
    like: t('food.preferences.like'),
    dislike: t('food.preferences.dislike')
  }))

  return {
    loadTranslations,
    tFood,
    translateFood,
    preferenceLabels
  }
}

