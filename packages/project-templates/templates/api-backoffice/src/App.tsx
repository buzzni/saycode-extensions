import { useEffect, useState, type FormEvent } from 'react'

import { CATEGORIES, createItem, deleteItem, listItems, updateItem, type Item } from './api'

interface ItemDraft {
  name: string
  category: string
  price: string
}

const EMPTY_DRAFT: ItemDraft = { name: '', category: CATEGORIES[0], price: '' }

export function App() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void listItems().then((rows) => {
      setItems(rows)
      setLoading(false)
    })
  }, [])

  function startEdit(item: Item) {
    setEditingId(item.id)
    setDraft({ name: item.name, category: item.category, price: String(item.price) })
    setError('')
  }

  function resetForm() {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    const price = Number(draft.price)
    if (!name) {
      setError('상품명을 입력해 주세요.')
      return
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('가격은 0 이상의 숫자로 입력해 주세요.')
      return
    }
    if (editingId === null) {
      const created = await createItem({ name, category: draft.category, price, active: true })
      setItems((current) => [...current, created])
    } else {
      const updated = await updateItem(editingId, { name, category: draft.category, price })
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    }
    resetForm()
  }

  async function toggleActive(item: Item) {
    const updated = await updateItem(item.id, { active: !item.active })
    setItems((current) => current.map((row) => (row.id === updated.id ? updated : row)))
  }

  async function remove(item: Item) {
    await deleteItem(item.id)
    setItems((current) => current.filter((row) => row.id !== item.id))
    if (editingId === item.id) resetForm()
  }

  return (
    <main className="backoffice">
      <header>
        <h1>상품 관리 백오피스</h1>
        <p>in-memory API(src/api.ts)로 동작합니다. 함수 본문만 실제 서버 호출로 바꾸세요.</p>
      </header>

      <section className="panel">
        <h2>{editingId === null ? '새 상품 등록' : `#${editingId} 수정`}</h2>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <form className="item-form" onSubmit={(event) => void submit(event)}>
          <input
            aria-label="상품명"
            placeholder="상품명"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <select
            aria-label="카테고리"
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          >
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input
            aria-label="가격"
            inputMode="numeric"
            placeholder="가격(원)"
            value={draft.price}
            onChange={(event) => setDraft({ ...draft, price: event.target.value })}
          />
          <button type="submit">{editingId === null ? '등록' : '저장'}</button>
          {editingId !== null ? <button type="button" className="ghost" onClick={resetForm}>취소</button> : null}
        </form>
      </section>

      <section className="panel">
        <h2>상품 목록</h2>
        {loading ? <p className="muted">불러오는 중...</p> : (
          <table>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">상품명</th>
                <th scope="col">카테고리</th>
                <th scope="col">가격</th>
                <th scope="col">상태</th>
                <th scope="col">동작</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.name}</td>
                  <td>{item.category}</td>
                  <td className="num">{item.price.toLocaleString()}원</td>
                  <td>
                    <button className={`pill ${item.active ? 'on' : 'off'}`} type="button" onClick={() => void toggleActive(item)}>
                      {item.active ? '판매 중' : '중지'}
                    </button>
                  </td>
                  <td className="actions">
                    <button className="ghost" type="button" onClick={() => startEdit(item)}>수정</button>
                    <button className="ghost danger" type="button" onClick={() => void remove(item)}>삭제</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr><td className="muted" colSpan={6}>등록된 상품이 없습니다.</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
