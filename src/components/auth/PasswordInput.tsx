'use client'
import { useState, type InputHTMLAttributes, type Ref } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  id: string
  inputRef?: Ref<HTMLInputElement>
}

/** Password field with a text "Show / Hide" button (clearer than an eye icon for older users). */
export default function PasswordInput({ id, inputRef, ...rest }: Props) {
  const [show, setShow] = useState(false)
  return (
    <div className="ui-input-wrap">
      <input {...rest} id={id} ref={inputRef} className="ui-input" type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="ui-input-action"
        onClick={() => setShow(s => !s)}
        aria-pressed={show}
        aria-controls={id}
      >
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
