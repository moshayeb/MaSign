import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ApiError, getCurrentUser, listContracts, logout as apiLogout, type Contract, type CurrentUser } from '../api'
import { AppFrame } from './AppFrame'
import { ContractList } from './ContractList'
import { UploadForm } from './UploadForm'

// Where a contract opens: the workspace, on that contract (its hash route).
function openInWorkspace(contractId: string) {
  window.location.href = `/workspace#${contractId}`
}

// The workspace frame for an app page that is not the workspace itself
// (MAS-221: Comparison rules). Picking or uploading a contract opens it in
// the workspace. Signed out (a confirmed 401), the sidebar shows no
// contracts and offers sign-in -- the page keeps its own signed-out
// message, exactly as before it had a sidebar. Nothing here toasts: the
// page's own loads report their own errors.
export function AppPageFrame({ current, children }: { current: string; children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [contractsError, setContractsError] = useState<string | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const loadContracts = useCallback(() => {
    setContractsError(null)
    setContracts(null)
    listContracts()
      .then(setContracts)
      .catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setSignedOut(true)
          return
        }
        setContractsError(error instanceof Error ? error.message : 'Could not load your contracts.')
      })
  }, [])

  // MAS-222: only a confirmed identity may load or upload workspace data.
  const loadUser = useCallback(() => {
    getCurrentUser()
      .then((current) => {
        setUser(current)
        loadContracts()
      })
      .catch((error) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setSignedOut(true)
        else setAuthError(error instanceof Error ? error.message : 'Could not verify your account.')
      })
  }, [loadContracts])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      window.location.href = '/login'
    }
  }, [])

  return (
    <AppFrame
      drawer
      drawerOpen={drawerOpen}
      onDrawerOpen={setDrawerOpen}
      user={user}
      onLogout={() => void logout()}
      current={current}
      signedOut={
        signedOut ? (
          <a className="link sidebar-signin" href="/login">
            Sign in
          </a>
        ) : undefined
      }
      sidebar={
        signedOut ? (
          <p className="muted small sidebar-signed-out">Sign in to see your contracts.</p>
        ) : authError ? (
          <div className="sidebar-contracts-error" role="status">
            <p>Could not verify your account: {authError}</p>
            <button type="button" className="link" onClick={() => { setAuthError(null); loadUser() }}>Retry account</button>
          </div>
        ) : !user ? (
          <p className="muted small" role="status">Loading account...</p>
        ) : (
          <>
            <UploadForm onUploaded={(contract) => openInWorkspace(contract.contract_id)} />
            {contractsError ? (
              <div className="sidebar-contracts-error" role="status">
                <p>Could not load your contracts: {contractsError}</p>
                <button type="button" className="link" onClick={loadContracts}>Refresh contracts</button>
              </div>
            ) : (
              <ContractList contracts={contracts} selectedId={null} onSelect={(contract) => openInWorkspace(contract.contract_id)} onReload={loadContracts} onDeleted={loadContracts} />
            )}
          </>
        )
      }
    >
      {children}
    </AppFrame>
  )
}
