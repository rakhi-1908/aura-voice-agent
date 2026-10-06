type Product = {
  id: string;
  name: string;
  category: string;
  skinType: string[];
  description: string;
};

const products: Product[] = [
  {
    id: 'vitamin-c-serum',
    name: 'Vitamin C Serum',
    category: 'Serum',
    skinType: ['Oily', 'Combination', 'Normal'],
    description: 'A brightening serum for a more even-looking complexion.',
  },
  {
    id: 'organic-rose-water-toner',
    name: 'Organic Rose Water Toner',
    category: 'Toner',
    skinType: ['Dry', 'Sensitive', 'Normal'],
    description: 'A gentle hydrating toner made with organic rose water.',
  },
  {
    id: 'ultra-hydrating-gel-sunscreen-spf-50',
    name: 'Ultra-Hydrating Gel Sunscreen SPF 50',
    category: 'Sunscreen',
    skinType: ['Oily', 'Combination', 'Sensitive'],
    description: 'A lightweight gel sunscreen with broad-spectrum SPF 50 protection.',
  },
  {
    id: 'saffron-kumkumadi-night-cream',
    name: 'Saffron & Kumkumadi Night Cream',
    category: 'Night Cream',
    skinType: ['Dry', 'Normal', 'Mature'],
    description: 'A nourishing overnight cream with saffron and kumkumadi.',
  },
];

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.trim().toLowerCase();
  if (!query) return Response.json(products);

  const terms = query.split(/\s+/).filter((term) => !['for', 'my', 'skin', 'type', 'the', 'a', 'an'].includes(term));
  if (terms.length === 0) return Response.json(products);

  const matches = products.filter((product) => {
    const searchableFields = [product.name, product.category, ...product.skinType].map((field) => field.toLowerCase());
    return terms.some((term) => searchableFields.some((field) => field.includes(term)));
  });

  return Response.json(matches);
}