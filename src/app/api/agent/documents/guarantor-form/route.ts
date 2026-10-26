import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { jsPDF } from 'jspdf'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { agentName } = await req.json()

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let yPos = 20

    pdf.setFontSize(18)
    pdf.text('🏦 Vochus Easy Save', 105, yPos, { align: 'center' })
    yPos += 10

    pdf.setFontSize(14)
    pdf.text('Agent Financial Guarantor Form', 105, yPos, { align: 'center' })
    yPos += 15

    pdf.setFontSize(11)
    const introText = 'This form declares that the undersigned person agrees to serve as a financial guarantor for the Vochus Easy Save Agent agreement. The guarantor assumes financial responsibility for any obligations arising from the agent\'s activities on the platform.'
    const splitIntro = pdf.splitTextToSize(introText, 170)
    pdf.text(splitIntro, 20, yPos)
    yPos += splitIntro.length * 5 + 10

    pdf.setFontSize(12)
    pdf.text('Agent Information', 20, yPos)
    yPos += 8

    pdf.setFontSize(10)
    pdf.text('Agent Name: ' + (agentName || '_____________________________________'), 20, yPos)
    yPos += 12

    pdf.setFontSize(12)
    pdf.text('Guarantor Information (Please Fill In)', 20, yPos)
    yPos += 8

    pdf.setFontSize(10)
    pdf.text('Full Name: _____________________________________________________', 20, yPos)
    yPos += 8
    pdf.text('Phone Number: _____________________________________________________', 20, yPos)
    yPos += 8
    pdf.text('Address: _____________________________________________________', 20, yPos)
    yPos += 8
    pdf.text('_____________________________________________________', 20, yPos)
    yPos += 12

    pdf.setFontSize(12)
    pdf.text('Guarantor Declaration & Signature', 20, yPos)
    yPos += 8

    pdf.setFontSize(10)
    const declarationText = 'I hereby declare that I have read and understood the terms of this guarantor agreement. I agree to assume financial responsibility and guarantee all obligations of the agent as outlined by Vochus Easy Save.'
    const splitDeclaration = pdf.splitTextToSize(declarationText, 170)
    pdf.text(splitDeclaration, 20, yPos)
    yPos += splitDeclaration.length * 5 + 15

    pdf.text('Guarantor Signature: ________________________________________________', 20, yPos)
    yPos += 25
    pdf.text('Date: ________________________', 20, yPos)
    yPos += 15

    pdf.setFontSize(9)
    pdf.text('This document must be signed by the guarantor and returned to the agent for submission to Vochus Easy Save.', 105, yPos + 5, { align: 'center' })

    pdf.setFontSize(8)
    const generatedDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    pdf.text(`Generated on ${generatedDate}`, 105, yPos + 15, { align: 'center' })

    const pdfBuffer = Buffer.from(pdf.output('arraybuffer'))

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="guarantor-form.pdf"',
      },
    })
  } catch (error) {
    console.error('Guarantor form error:', error)
    return NextResponse.json({ error: 'Failed to generate form' }, { status: 500 })
  }
}
