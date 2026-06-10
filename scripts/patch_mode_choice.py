from pathlib import Path

path = Path('src/components/booking/AppointmentBookingFlow.tsx')
text = path.read_text(encoding='utf-8')
start = text.index('          <h2 className="mb-2 text-lg font-semibold text-slate-900">How would you like to book?</h2>')
end = text.index('          </motion.div>\n        </motion.div>\n      )}\n\n      {/* ════════════════════════════════════════════════\n          SINGLE BOOKING FLOW')
# fix - search for exact end marker
end_marker = '          </div>\n        </motion.div>\n      )}\n\n      {/* ════════════════════════════════════════════════\n          SINGLE BOOKING FLOW'
if end_marker not in text:
    end_marker = '          </div>\n        </div>\n      )}\n\n      {/* ════════════════════════════════════════════════\n          SINGLE BOOKING FLOW'
end = text.index(end_marker)

replacement = '''          <AppointmentStepHeader
            title="How would you like to book?"
            description="Choose a single appointment or a group booking for several people."
          />
          <div className="space-y-3">
            <AppointmentChoiceCard
              onClick={() => setStep('service')}
              title="Book an appointment"
              description="Schedule an appointment for yourself"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              }
            />
            <AppointmentChoiceCard
              onClick={() => setStep('group_review')}
              title="Group appointment"
              description="Different services for multiple people"
              tone="group"
              icon={
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
              }
            />
          </div>'''

text = text[:start] + replacement + text[end:]
path.write_text(text, encoding='utf-8', newline='\n')
print('patched mode_choice')
