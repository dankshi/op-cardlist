import { redirect } from 'next/navigation'

// "My Stuff" was the combined buyer+seller hub. It's been split: the buyer
// area is now the Collection portfolio (/collection), purchases live at
// /orders, offers at /offers, and seller tooling at /sellerhub. This redirect
// keeps old links / bookmarks (including ?tab=...) landing somewhere sensible.
export default function MyStuffPage() {
  redirect('/collection')
}
