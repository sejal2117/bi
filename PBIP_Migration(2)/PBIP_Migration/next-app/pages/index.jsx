import { useEffect } from 'react'

export default function Home() {
  useEffect(() => { window.location.replace('/wireframe') }, [])
  return null
}