import { FileIcon } from "@react-symbols/icons/utils"
import { useContext } from "react"
import { useMissingFiles } from "@/lib/missing-files"
import { NavContext } from "@/lib/nav"
import { cn } from "@/lib/utils"

export function FileReferenceLabel({ name }: { name: string }) {
  return <>
    <FileIcon fileName={name} autoAssign width={16} height={16} className="mr-1 inline-block align-text-bottom file-icon" aria-hidden="true" />
    <span>{name}</span>
  </>
}

export function FileReference({ path }: { path: string }) {
  const nav = useContext(NavContext)
  const missing = useMissingFiles(nav ? [path] : []).has(path)
  const label = <FileReferenceLabel name={path.split("/").pop() ?? path} />
  if (!nav) return <span className="underline underline-offset-2">{label}</span>
  return (
    <a
      href={`#${new URLSearchParams({ file: path })}`}
      title={missing ? `/${path} was moved or deleted` : `Open /${path}`}
      className={cn("wrap-anywhere underline underline-offset-2", missing && "line-through opacity-60")}
      onClick={(e) => { e.preventDefault(); nav.openFile(path) }}
    >{label}</a>
  )
}
