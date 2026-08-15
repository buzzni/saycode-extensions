/**
 * 데모용 in-memory API. 실제 백엔드가 준비되면 이 파일의 함수 본문만
 * fetch 호출로 바꾸면 화면 코드는 그대로 동작합니다.
 */
export interface Item {
  id: number
  name: string
  category: string
  price: number
  active: boolean
}

export const CATEGORIES = ['식품', '생활', '전자', '기타']

let nextId = 4
let items: Item[] = [
  { id: 1, name: '유기농 원두 1kg', category: '식품', price: 24000, active: true },
  { id: 2, name: '스탠드 조명', category: '생활', price: 58000, active: true },
  { id: 3, name: '무선 키보드', category: '전자', price: 89000, active: false },
]

const delay = () => new Promise((resolve) => setTimeout(resolve, 120))

export async function listItems(): Promise<Item[]> {
  await delay()
  return [...items]
}

export async function createItem(input: Omit<Item, 'id'>): Promise<Item> {
  await delay()
  const item = { ...input, id: nextId++ }
  items = [...items, item]
  return item
}

export async function updateItem(id: number, patch: Partial<Omit<Item, 'id'>>): Promise<Item> {
  await delay()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) throw new Error(`항목을 찾을 수 없습니다: ${id}`)
  const updated = { ...items[index], ...patch }
  items = items.map((item) => (item.id === id ? updated : item))
  return updated
}

export async function deleteItem(id: number): Promise<void> {
  await delay()
  items = items.filter((item) => item.id !== id)
}
