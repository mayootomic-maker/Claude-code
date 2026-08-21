import { render } from 'preact'
import { App } from './app'
import './styles/app.css'

const root = document.getElementById('app')
if (root === null) throw new Error('missing #app root element')
render(<App />, root)
