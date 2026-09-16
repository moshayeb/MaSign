import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { listContracts, type Contract } from './api'
import { ContractList } from './components/ContractList'
import { UploadForm } from './components/UploadForm'

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)
  // Loads can overlap (Refresh while an upload's reload is in flight); only
  // the most recent request may set the list, whatever order they return in (MAS-66).
  const latestLoad = useRef(0)

  const load = useCallback(async () => {
    const id = ++latestLoad.current
    const loaded = await listContracts()
    if (id === latestLoad.current) setContracts(loaded)
    return loaded
  }, [])

  // Automatic loads (on mount, after an upload): the outcome is on screen, so
  // only a failure is announced — with the API's detail.
  const reload = useCallback(async () => {
    try {
      await load()
    } catch (error) {
      toast.error((error as Error).message)
      setContracts((current) => current ?? [])
    }
  }, [load])

  // The Refresh button is a user action, so it reports its outcome (MAS-68).
  const refresh = useCallback(async () => {
    try {
      await toast
        .promise(load(), {
          loading: 'Refreshing contracts…',
          success: (list) => `Contract list up to date — ${list.length} contract${list.length === 1 ? '' : 's'}`,
          error: (e: Error) => e.message,
        })
        .unwrap()
    } catch {
      // Already reported by the toast.
      setContracts((current) => current ?? [])
    }
  }, [load])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      <header className="app-header">
        <h1>MaSign</h1>
        <p className="muted">Upload a contract, then pick it to ask questions about it.</p>
      </header>
      <main>
        <UploadForm
          onUploaded={(contract) => {
            setSelected(contract)
            void reload()
          }}
        />
        <ContractList contracts={contracts} selectedId={selected?.contract_id ?? null} onSelect={setSelected} onReload={refresh} />
        {selected && (
          <section className="selected">
            <h2>Selected</h2>
            <p>
              <strong>{selected.filename}</strong> — {selected.chunk_count} chunks, {selected.character_count.toLocaleString()}{' '}
              characters. Questions and risk analysis arrive with MAS-18.
            </p>
          </section>
        )}
      </main>
    </>
  )
}
