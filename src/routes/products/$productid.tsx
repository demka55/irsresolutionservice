import { Link, createFileRoute } from '@tanstack/react-router'
import products from '../../data/products'

export const Route = createFileRoute('/products/$productId')({
  component: RouteComponent,
  loader: async ({ params }) => {
    const product = products.find(
      (product) => product.id === +params.productId,
    )
    if (!product) {
      throw new Error('Product not found')
    }
    return product
  },
})

function RouteComponent() {
  const product = Route.useLoaderData()

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center text-accent font-medium hover:underline mb-8"
        >
          &larr; Back to all products
        </Link>

        <div className="flex flex-col md:flex-row gap-12">
          <div className="w-full md:w-[55%]">
            <img
              src={product.image}
              alt={product.name}
              className="w-full rounded-2xl object-cover shadow-sm"
            />
          </div>

          <div className="w-full md:w-[45%]">
            <h1 className="text-4xl font-bold text-text-primary mb-4">{product.name}</h1>
            <p className="text-text-muted leading-relaxed mb-8">{product.description}</p>
            <div className="flex items-center justify-between border-t border-border pt-6">
              <div className="text-3xl font-bold text-text-primary">
                ${product.price.toLocaleString()}
              </div>
              <button className="bg-accent text-white font-semibold px-8 py-3 rounded-lg hover:bg-accent-hover transition-colors">
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
