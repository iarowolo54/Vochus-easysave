/** Shown wherever someone is about to pay on Paystack. A bank transfer is only credited once they tap the button on Paystack's page. */
export default function TransferReminder() {
  return (
    <p className="ui-note ui-note--center ui-transfer-reminder">
      Paying by bank transfer? After you send the money, tap <strong>“I’ve sent the money”</strong> on the Paystack page. If you forget, your payment will not show.
    </p>
  )
}
