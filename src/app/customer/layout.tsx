import CustomerIdleTimeout from '@/components/CustomerIdleTimeout'

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CustomerIdleTimeout />
      <style>{`
        :root {
          --g: #17783a; --gl: #e7f3ea; --gm: #9fd3ae; --gdk: #125e2d;
          --gd: #c8841a; --gdl: #fdf3e0;
          --rd: #c0392b; --rdl: #fdecea;
          --b: #1a5fa8; --bl: #e8f0fb;
          --bg: #f3f6f3; --card: #fff;
          --txt: #111a14; --mu: #6b8070; --br: #d8e8dd;
          --r: 14px; --top: 56px; --bot: 64px;
        }
        body {
          font-family: 'Inter', sans-serif !important;
          background: var(--bg) !important;
          color: var(--txt) !important;
          overflow-x: hidden;
        }
        .customer-page input,
        .customer-page select,
        .customer-page textarea {
          width: 100%; padding: 13px 14px;
          border: 1.5px solid var(--br); border-radius: 11px;
          font-size: 15px; font-family: 'Inter', sans-serif; color: var(--txt);
          background: var(--card); outline: none; margin-bottom: 13px;
          transition: border-color .15s, box-shadow .15s; -webkit-appearance: none;
          box-sizing: border-box;
        }
        .customer-page input:focus,
        .customer-page select:focus,
        .customer-page textarea:focus {
          border-color: var(--g); box-shadow: 0 0 0 3px rgba(26,107,58,.1);
        }
      `}</style>
      <div className="customer-page">{children}</div>
    </>
  )
}
