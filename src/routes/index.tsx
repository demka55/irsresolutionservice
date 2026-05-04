import { Link, createFileRoute } from '@tanstack/react-router'
import products from '@/data/products'

export const Route = createFileRoute('/')({
  component: ProductsIndex,
})

function ProductsIndex() {
  return (
    <div className="bg-bg-primary min-h-screen">
      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-20">
        <div className="flex flex-col md:flex-row items-center gap-12">
          <div className="md:w-1/2">
            <h1 className="text-5xl md:text-6xl font-bold leading-tight text-text-primary tracking-tight">
              We build what <span className="text-accent">matters.</span>
            </h1>
            <p className="mt-6 text-lg text-text-muted leading-relaxed max-w-lg">
              A product company focused on delivering real value. Simple tools, bold ideas, relentless execution.
            </p>
            <a
              href="#products"
              className="mt-8 inline-block bg-accent text-white font-semibold px-8 py-3 rounded-lg hover:bg-accent-hover transition-colors"
            >
              See Our Work
            </a>
          </div>
          <div className="md:w-1/2 flex gap-4">
            <div className="w-1/2">
              <img
                src="/person-2.png"
                alt="Team member"
                className="w-full rounded-2xl object-cover aspect-[3/4] shadow-lg"
              />
            </div>
            <div className="w-1/2 mt-8">
              <img
                src="/person-1.png"
                alt="Team member"
                className="w-full rounded-2xl object-cover aspect-[3/4] shadow-lg"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Products Section */}
      <section id="products" className="bg-bg-secondary py-20">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-accent mb-2">Products</h2>
          <p className="text-3xl font-bold text-text-primary mb-14">What we're working on</p>

          <div className="space-y-24">
            {products.map((product, index) => (
              <div
                key={product.id}
                className={`flex flex-col md:flex-row items-stretch gap-10 ${
                  index % 2 === 1 ? 'md:flex-row-reverse' : ''
                }`}
              >
                <div className="w-full md:w-[58%]">
                  <Link
                    to="/products/$productId"
                    params={{ productId: product.id.toString() }}
                    className="block group"
                  >
                    <div className="w-full aspect-[4/3] overflow-hidden rounded-2xl bg-white shadow-sm">
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    </div>
                  </Link>
                </div>

                <div className="w-full md:w-[42%] flex items-center">
                  <div className="bg-white rounded-2xl p-8 border border-border shadow-sm w-full">
                    <h3 className="text-2xl font-bold text-text-primary mb-3">{product.name}</h3>
                    <p className="text-text-muted mb-6 leading-relaxed">
                      {product.shortDescription}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="text-2xl font-bold text-text-primary">
                        ${product.price.toLocaleString()}
                      </div>
                      <Link
                        to="/products/$productId"
                        params={{ productId: product.id.toString() }}
                        className="text-accent font-semibold hover:underline"
                      >
                        Learn more &rarr;
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 text-center text-text-muted text-sm border-t border-border">
        &copy; {new Date().getFullYear()} Product Company. All rights reserved.
      </footer>
    </div>
  )
}
