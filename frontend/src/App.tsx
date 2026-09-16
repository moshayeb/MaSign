import { useCallback, useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { listContracts, type Contract } from './api'
import { ContractList } from './components/ContractList'
import { UploadForm } from './components/UploadForm'

export default function App() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [selected, setSelected] = useState<Contract | null>(null)

  const reload = useCallback(async () => {
    try {
      setContracts(await listContracts())
    } catch (error) {
      // The list stays as it was; the toast carries the API's detail.
      toast.error((error as Error).message)
      setContracts((current) => current ?? [])
    }
  }, [])

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
        <ContractList contracts={contracts} selectedId={selected?.contract_id ?? null} onSelect={setSelected} onReload={reload} />
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
