import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { api, type MoveRequest, type Project } from "@/lib/api"
import { activeTenant } from "@/lib/tenant"
import { subscribeUserEvents } from "@/lib/user-stream"

/** The tenant's projects, the one being looked at (remembered per tenant), and moves waiting for approval. */
export interface Projects {
  projects: Project[]
  active?: Project
  setActive: (id: string) => void
  moves: MoveRequest[]
  reload: () => void
  /** Where uploads made in a project land: its own folder; undefined for General (they stay by the conversation). */
  uploadFolder: (projectId?: string) => string | undefined
}

const ProjectsContext = createContext<Projects | null>(null)
const storageKey = () => `pi-group:project:${activeTenant()}`

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [moves, setMoves] = useState<MoveRequest[]>([])
  const [activeId, setActiveId] = useState(() => localStorage.getItem(storageKey()) ?? undefined)

  const reload = useCallback(() => {
    void api.projects().then(({ projects }) => setProjects(projects), () => {})
    void api.projectMoves().then(({ moves }) => setMoves(moves), () => {})
  }, [])
  useEffect(() => {
    reload()
    return subscribeUserEvents((event) => (event.type === "projects" || event.type === "stream_open") && reload())
  }, [reload])

  const setActive = useCallback((id: string) => {
    localStorage.setItem(storageKey(), id)
    setActiveId(id)
  }, [])

  const value = useMemo(() => {
    const uploadFolder = (projectId?: string) => {
      const project = projects.find((p) => p.id === projectId)
      return project && !project.general ? project.folder : undefined
    }
    return { projects, active: projects.find((p) => p.id === activeId) ?? projects.find((p) => p.general), setActive, moves, reload, uploadFolder }
  }, [projects, activeId, setActive, moves, reload])
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects() {
  const projects = useContext(ProjectsContext)
  if (!projects) throw new Error("useProjects outside ProjectsProvider")
  return projects
}
