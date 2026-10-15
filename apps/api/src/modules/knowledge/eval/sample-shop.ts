/**
 * A made-up shoe shop for the retrieval quality check (M2-16, lead's call:
 * fictional data). The questions are worded the way customers write, not
 * copied from the FAQs, so the check measures meaning, not word overlap.
 * Keep it stable: results are only comparable run to run on the same data.
 */

export interface SampleFaq {
  id: string;
  question: string;
  answer: string;
}

export interface SamplePolicy {
  id: string;
  title: string;
  /** Markdown, split into chunks like a real policy page. */
  content: string;
}

export interface SampleQuestion {
  question: string;
  /** The FAQ or policy id a good search returns. */
  expected: string;
}

export const SAMPLE_FAQS: SampleFaq[] = [
  {
    id: 'faq-hours',
    question: 'What are your opening hours?',
    answer:
      'Our Dhanmondi store is open Saturday to Thursday, 10am to 9pm, and Friday from 3pm to 9pm. Online orders are accepted 24/7.',
  },
  {
    id: 'faq-location',
    question: 'Where is your store?',
    answer:
      'Stride Shoes is at House 12, Road 7, Dhanmondi, Dhaka, on the ground floor next to the pharmacy.',
  },
  {
    id: 'faq-sizes',
    question: 'How do I find my shoe size?',
    answer:
      'Measure your foot from heel to longest toe in centimetres and use the size chart on each product page. Between two sizes? Pick the larger one.',
  },
  {
    id: 'faq-wide',
    question: 'Do you sell wide-fit shoes?',
    answer:
      'Yes. Models marked "Wide" in the name come in E and 2E widths, including the Trail Runner and the Office Classic.',
  },
  {
    id: 'faq-payment',
    question: 'Which payment methods do you accept?',
    answer:
      'We accept bKash, Nagad, Visa and Mastercard, and cash on delivery inside Dhaka.',
  },
  {
    id: 'faq-tracking',
    question: 'How can I track my order?',
    answer:
      'After your order ships we send an SMS with a tracking link from our courier, Pathao. You can also call us with your order number.',
  },
  {
    id: 'faq-cancel',
    question: 'Can I cancel my order?',
    answer:
      'You can cancel free of charge until the order is handed to the courier, usually within 12 hours. After that, use the return process instead.',
  },
  {
    id: 'faq-care',
    question: 'How should I clean leather shoes?',
    answer:
      'Wipe them with a damp cloth, let them dry away from direct sun, and apply leather conditioner once a month. Never put leather shoes in a washing machine.',
  },
  {
    id: 'faq-waterproof',
    question: 'Are your shoes waterproof?',
    answer:
      'Only models with the "WP" label are waterproof; they have a sealed membrane suitable for monsoon rain. Other models are water-resistant at best.',
  },
  {
    id: 'faq-kids',
    question: 'Do you have shoes for children?',
    answer:
      'Yes, our kids range covers sizes 25 to 35, with velcro school shoes and light sneakers.',
  },
  {
    id: 'faq-giftcard',
    question: 'Do you sell gift cards?',
    answer:
      'Gift cards from 1,000 to 10,000 taka are available in store and online. They are valid for one year and can be used for several purchases.',
  },
  {
    id: 'faq-wholesale',
    question: 'Do you offer bulk or corporate orders?',
    answer:
      'For orders of 20 pairs or more, for example office uniforms or school teams, email sales@stride.example and we will send a quote with a discount.',
  },
  {
    id: 'faq-stock',
    question: 'A size is sold out. Will it come back?',
    answer:
      'Most sizes are restocked within three weeks. Use the "Notify me" button on the product page to get an SMS when it is back.',
  },
  {
    id: 'faq-tryon',
    question: 'Can I try shoes before buying?',
    answer:
      'You can try any pair in our Dhanmondi store. For home delivery inside Dhaka, the rider can wait 10 minutes while you try the shoes on.',
  },
  {
    id: 'faq-contact',
    question: 'How can I contact customer support?',
    answer:
      'Call or WhatsApp +880 1711 000000 between 10am and 8pm, or email support@stride.example. We reply to emails within one working day.',
  },
];

export const SAMPLE_POLICIES: SamplePolicy[] = [
  {
    id: 'policy-returns',
    title: 'Returns and exchanges',
    content: `# Returns and exchanges

## Return window
You can return unworn shoes within 14 days of delivery for a full refund. Shoes must be in the original box with all tags attached.

## Exchanges
Exchanges for a different size or colour are free once per order, as long as the new pair is in stock.

## Refunds
Refunds go back to the original payment method within 7 working days after we receive the shoes. Cash on delivery orders are refunded by bKash.

## Sale items
Items bought at more than 40% off can be exchanged but not refunded.`,
  },
  {
    id: 'policy-shipping',
    title: 'Shipping and delivery',
    content: `# Shipping and delivery

## Inside Dhaka
Delivery inside Dhaka takes 1 to 2 days and costs 60 taka. Orders over 3,000 taka ship free.

## Outside Dhaka
Delivery to other districts takes 3 to 5 days and costs 120 taka. Cash on delivery is not available outside Dhaka; pay online instead.

## International
We do not ship outside Bangladesh at the moment.`,
  },
  {
    id: 'policy-warranty',
    title: 'Warranty',
    content: `# Warranty

All shoes have a 6-month warranty against manufacturing defects such as sole separation or broken stitching. Normal wear, scuffs and damage from misuse are not covered.

To make a claim, bring the shoes and your receipt to the store or send photos to support@stride.example. We repair or replace the pair within 10 days.`,
  },
  {
    id: 'policy-privacy',
    title: 'Privacy',
    content: `# Privacy

We only collect the details needed to deliver your order: name, phone number and address. We never sell your data. Card payments are processed by our payment provider; we do not store card numbers.`,
  },
];

export const SAMPLE_QUESTIONS: SampleQuestion[] = [
  { question: 'when do you open on friday', expected: 'faq-hours' },
  { question: 'whats the address of the shop', expected: 'faq-location' },
  {
    question: 'I am between size 41 and 42, which should I order?',
    expected: 'faq-sizes',
  },
  {
    question: 'my feet are broad, do you have anything for me',
    expected: 'faq-wide',
  },
  { question: 'can I pay with bkash?', expected: 'faq-payment' },
  { question: 'where is my parcel', expected: 'faq-tracking' },
  {
    question: 'I ordered by mistake, how do I stop the order',
    expected: 'faq-cancel',
  },
  { question: 'how do I take care of leather boots', expected: 'faq-care' },
  {
    question: 'will these survive the rainy season?',
    expected: 'faq-waterproof',
  },
  { question: 'school shoes for my son', expected: 'faq-kids' },
  {
    question: 'I want to buy a voucher as a birthday present',
    expected: 'faq-giftcard',
  },
  {
    question: 'we need 50 pairs for our company staff',
    expected: 'faq-wholesale',
  },
  {
    question: 'size 43 is out of stock, when will you get more',
    expected: 'faq-stock',
  },
  { question: 'what is your phone number', expected: 'faq-contact' },
  {
    question: 'can I send back shoes that do not fit',
    expected: 'policy-returns',
  },
  {
    question: 'how long until I get my money back',
    expected: 'policy-returns',
  },
  {
    question: 'how much is delivery to Chittagong',
    expected: 'policy-shipping',
  },
  { question: 'do you deliver to India', expected: 'policy-shipping' },
  {
    question: 'the sole came off after two months',
    expected: 'policy-warranty',
  },
  { question: 'do you keep my card details', expected: 'policy-privacy' },
];
